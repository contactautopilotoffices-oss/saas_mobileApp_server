import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');
    const stateParam = requestUrl.searchParams.get('state');
    const error = requestUrl.searchParams.get('error');

    let appOrigin = requestUrl.origin || process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');

    // Fallback redirect for the mobile app if parsing state fails
    let redirectTo = 'autopilot://auth/callback';

        if (error || !code) {
            console.error('[ZOHO MOBILE] OAuth error:', error);
            return NextResponse.redirect(`${redirectTo}?error=zoho_oauth_error_${error}`);
        }

        try {
            if (stateParam) {
                try {
                    const state = JSON.parse(Buffer.from(stateParam, 'base64').toString());
                    if (state.redirect_to) redirectTo = state.redirect_to;
                    if (state.origin) appOrigin = state.origin.replace(/\/$/, '');
                } catch {
                    // ignore malformed state
                }
            }

            // 1. Exchange Zoho code for access token
            const tokenRes = await fetch('https://accounts.zoho.com/oauth/v2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: process.env.ZOHO_CLIENT_ID!,
                    client_secret: process.env.ZOHO_CLIENT_SECRET!,
                    redirect_uri: `${appOrigin}/api/auth/zoho/callback`,
                    grant_type: 'authorization_code',
                }),
            });

            const tokenData = await tokenRes.json();
            if (!tokenData.access_token) {
                console.error('[ZOHO MOBILE] token exchange failed:', tokenData);
                return NextResponse.redirect(`${redirectTo}?error=token_exchange_failed`);
            }

            // 2. Get user info from Zoho
            const userRes = await fetch('https://accounts.zoho.com/oauth/v2/userinfo', {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${tokenData.access_token}`
                }
            });
            
            const zohoUser = await userRes.json();
            const email: string = zohoUser.email || zohoUser.Email;
            const fullName: string = zohoUser.name || zohoUser.given_name || email?.split('@')[0] || 'User';
            const avatarUrl: string = zohoUser.picture || '';

            if (!email) {
                console.error('[ZOHO MOBILE] no email from Zoho', zohoUser);
                return NextResponse.redirect(`${redirectTo}?error=no_email_from_zoho`);
            }

            const supabaseAdmin = createAdminClient();

            // 3. Find or create user in Supabase
            const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
            let user = usersData?.users.find((u: any) => u.email === email);

            if (!user) {
                const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
                    email,
                    email_confirm: true,
                    user_metadata: {
                        full_name: fullName,
                        avatar_url: avatarUrl,
                        provider: 'zoho',
                    },
                });
                if (createError) {
                    // If they already exist, listUsers just missed them due to pagination!
                    // We can safely proceed without the user object (we just skip the upsert).
                    if (!createError.message.includes('already been registered')) {
                        console.error('[ZOHO MOBILE] create user failed:', createError.message);
                        return NextResponse.redirect(`${redirectTo}?error=create_user_failed_${encodeURIComponent(createError.message)}`);
                    }
                } else {
                    user = newUser.user;
                }
            }

            // 4. Generate magic link (admin, no PKCE — returns raw token in action_link)
            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'magiclink',
                email,
                options: {
                    redirectTo: appOrigin
                }
            });

            // Support both old and new Supabase client formats
            const actionLink = (linkData as any)?.properties?.action_link || (linkData as any)?.action_link;

            if (linkError || !actionLink) {
                console.error('[ZOHO MOBILE] generateLink failed:', linkError?.message);
                return NextResponse.redirect(`${redirectTo}?error=generate_link_failed_${encodeURIComponent(linkError?.message || 'no_link')}`);
            }

            // 5. GET the action_link server-side with redirect:manual
            const actionRes = await fetch(actionLink, {
                redirect: 'manual',
            });

            const location = actionRes.headers.get('location') ?? '';
            
            let access_token: string | null = null;
            let refresh_token: string | null = null;

            if (location.includes('#')) {
                const hash = location.split('#')[1] ?? '';
                const hashParams = new URLSearchParams(hash);
                access_token = hashParams.get('access_token');
                refresh_token = hashParams.get('refresh_token');
            }

            if (!access_token || !refresh_token) {
                console.error('[ZOHO MOBILE] no tokens in action_link redirect. Location:', location);
                return NextResponse.redirect(`${redirectTo}?error=missing_tokens_in_redirect`);
            }

            // Upsert user profile only if we successfully created them or found them
            if (user) {
                await supabaseAdmin.from('users').upsert({
                    id: user.id,
                    full_name: user.user_metadata?.full_name || fullName,
                    email: email,
                    metadata: user.user_metadata,
                });
            }

            // Redirect back to mobile app with tokens in query parameters!
            // Expo Router strips hash fragments (#), so query params (?) are required here.
            return NextResponse.redirect(`${redirectTo}?access_token=${access_token}&refresh_token=${refresh_token}`);

        } catch (err: any) {
            console.error('[ZOHO MOBILE] callback error:', err);
            return NextResponse.redirect(`${redirectTo || 'autopilot://auth/callback'}?error=fatal_try_catch_${encodeURIComponent(err.message || 'unknown')}`);
        }
}
