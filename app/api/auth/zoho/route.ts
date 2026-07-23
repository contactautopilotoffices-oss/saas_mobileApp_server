import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    // redirect_to is the deep link passed from the mobile app (e.g. autopilot://auth/callback)
    const redirect_to = requestUrl.searchParams.get('redirect_to') || '';

    const origin = requestUrl.origin || process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
    const state = Buffer.from(JSON.stringify({ redirect_to, origin })).toString('base64');

    const zohoAuthUrl = new URL('https://accounts.zoho.com/oauth/v2/auth');
    zohoAuthUrl.searchParams.set('client_id', process.env.ZOHO_CLIENT_ID!);
    zohoAuthUrl.searchParams.set('response_type', 'code');
    
    const appOrigin = requestUrl.origin || process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
    zohoAuthUrl.searchParams.set('redirect_uri', `${appOrigin}/api/auth/zoho/callback`);
    zohoAuthUrl.searchParams.set('scope', 'openid profile email');
    zohoAuthUrl.searchParams.set('access_type', 'online');
    zohoAuthUrl.searchParams.set('state', state);

    return NextResponse.redirect(zohoAuthUrl.toString());
}
