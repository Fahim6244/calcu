export function isOwner(user,ownerEmail){return Boolean(ownerEmail&&user?.email&&user.email.toLowerCase()===ownerEmail.toLowerCase());}
