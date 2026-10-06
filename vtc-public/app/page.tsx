import vehicles from '@/data/vehicle-reference.json';
import {vehicleDetails} from '@/lib/vehicle.mjs';
import Checker from './checker';
import {runtime} from '@/lib/server';
import reference from '@/data/reference.json';
export default function Page(){const records=Object.fromEntries(Object.entries(reference.records).map(([p,r])=>[p,{category:r.category,info:r.info,vehicle:vehicleDetails(p,vehicles)}]));return <><div className="preview-banner">{!runtime().GOOGLE_SERVICE_ACCOUNT_JSON&&<>Versión de revisión · Google Sheets pendiente de conexión</>}</div><Checker snapshot={{records,sourceDate:reference.sourceDate}}/></>;}
