import {requireChatGPTUser} from '@/app/chatgpt-auth';import {requireOwner} from '@/lib/admin';import Review from './review';
export const dynamic='force-dynamic';
export default async function Page(){await requireChatGPTUser('/admin');try{await requireOwner()}catch{return <main className="workspace"><h1>Área privada</h1><p>Esta cuenta no tiene acceso a la revisión.</p><a href="/">Volver al buscador</a></main>}return <Review/>;}
