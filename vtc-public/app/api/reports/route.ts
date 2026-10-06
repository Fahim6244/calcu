import {route,input,credential,service,json,rate} from '@/lib/server';
export async function POST(req:Request){return route(async()=>{await rate(req,'reserve',15);const body=await input(req);return json(await service().reserve(body.plate,credential(req)));});}
