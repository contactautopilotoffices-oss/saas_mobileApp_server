require('dotenv').config();
const { getPropertyAccess } = require('./lib/auth');

async function test() {
  const userId = '45dbd301-eca5-4911-aea1-5c4fa40fe54b'; // staff
  const propertyId = 'bf345711-06fc-405f-b3a6-0a4888fff8b2';
  const res = await getPropertyAccess(userId, propertyId);
  console.log('Access:', res);
}
test();
