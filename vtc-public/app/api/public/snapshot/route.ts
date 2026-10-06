import vehicles from '@/data/vehicle-reference.json';
import {vehicleDetails} from '@/lib/vehicle.mjs';
import {route,json,database} from '@/lib/server';
import snapshot from '@/data/reference.json';
export async function GET(){return route(async()=>{const r=await database().prepare("SELECT plate,category,details,vehicle,updated_at FROM reports WHERE publication='published' AND status='approved'").all();const records:any=Object.fromEntries(Object.entries(snapshot.records).map(([p,r])=>[p,{category:r.category,info:r.info,vehicle:vehicleDetails(p,vehicles)}]));for(const row of r.results)records[String(row.plate)]={category:row.category,info:row.details,verifiedAt:row.updated_at,vehicle:row.vehicle?{...vehicleDetails(String(row.plate),vehicles),vehicle:row.vehicle,sourceDate:new Date(Number(row.updated_at)).toISOString().slice(0,10),source:'revisión aprobada'}:vehicleDetails(String(row.plate),vehicles)};return json({records,sourceDate:snapshot.sourceDate});});}
