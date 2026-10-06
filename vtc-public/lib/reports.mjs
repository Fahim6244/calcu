import {normalizePlate} from './plates.mjs';
export class AppError extends Error{constructor(message,status=409){super(message);this.status=status;}}
export const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
export class ReportService{
 /** @param {any} db @param {()=>number} now @param {(plate:string)=>boolean|Promise<boolean>} eligible */
 constructor(db,now=()=>Date.now(),eligible=()=>false){this.db=db;this.now=now;this.eligible=eligible;}
 q(sql,...args){return this.db.prepare(sql).bind(...args);}
 async get(id,credential){const row=await this.q('SELECT * FROM reports WHERE id=?',id).first();if(!row||row.credential_hash!==await hash(credential))throw new AppError('Borrador no disponible en este dispositivo.',403);const {credential_hash,...safe}=row;return safe;}
 async reserve(raw,credential){const plate=normalizePlate(raw);if(!/^\d{4}[A-Z]{3}$/.test(plate)||credential.length<32||!await this.eligible(plate))throw new AppError('Esta matrícula no admite una nueva aportación.',400);const ch=await hash(credential),now=this.now();const old=await this.q('SELECT r.* FROM reports r JOIN reservations s ON s.report_id=r.id WHERE s.plate=?',plate).first();
 if(old?.credential_hash===ch){if(old.status!=='draft'&&old.status!=='needs_info')return this.get(old.id,credential);await this.q('UPDATE reservations SET expires=? WHERE plate=? AND report_id=?',now+1800000,plate,old.id).run();return this.get(old.id,credential);}
 const id=crypto.randomUUID(),job=crypto.randomUUID();await this.db.batch([
 this.q('INSERT INTO reservations(plate,report_id,expires,blocked) VALUES(?,?,?,0) ON CONFLICT(plate) DO UPDATE SET report_id=excluded.report_id,expires=excluded.expires,blocked=0 WHERE reservations.blocked=0 AND reservations.expires<?',plate,id,now+1800000,now),
 this.q("INSERT INTO reports(id,plate,credential_hash,created_at,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM reservations WHERE plate=? AND report_id=?)",id,plate,ch,now,now,plate,id),
 this.q('INSERT INTO outbox(id,report_id,revision,created_at) SELECT ?,id,revision,? FROM reports WHERE id=?',job,now,id),
 this.q("INSERT INTO audit(id,report_id,revision,actor,action,payload,created_at) SELECT ?,id,revision,'contributor','draft','{}',? FROM reports WHERE id=?",job,now,id)]);
 const row=await this.q('SELECT id FROM reports WHERE id=?',id).first();if(!row)throw new AppError('Ya existe una aportación o una captura en curso para esta matrícula.');return this.get(id,credential);}
 async mutate(id,credential,revision,input){const row=await this.get(id,credential);if(!Number.isInteger(revision)||row.revision!==revision)throw new AppError('El borrador ha cambiado. Vuelve a cargarlo.');if(!['draft','needs_info'].includes(row.status))throw new AppError('Esta aportación ya está en revisión.');if(!await this.eligible(row.plate))throw new AppError('La categoría ha cambiado. Se necesita revisión.');const claim=await this.q('SELECT report_id FROM reservations WHERE plate=?',row.plate).first();if(claim?.report_id!==id)throw new AppError('La reserva de esta matrícula ha cambiado. Tus fotos siguen en este dispositivo.');
 const note=input.note===undefined?row.note:String(input.note);if(note.length>1500)throw new AppError('La nota no puede superar 1500 caracteres.',400);const category=input.category??row.category;if(!['unknown','outside_catalunya','white_plate','mismatch'].includes(category))throw new AppError('Categoría no válida.',400);
 if(input.submit){const ev=await this.q('SELECT kind FROM evidence WHERE report_id=?',id).all();if(!ev.results.some(x=>x.kind==='vehicle')||!ev.results.some(x=>x.kind==='official'))throw new AppError('Añade una foto del vehículo y una captura del registro oficial.',400);}
 const now=this.now(),next=revision+1,job=crypto.randomUUID(),status=input.submit?'pending':row.status;const results=await this.db.batch([
 this.q('UPDATE reports SET note=?,category=?,status=?,revision=?,updated_at=?,last_op=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM reservations WHERE report_id=? AND plate=reports.plate)',note,category,status,next,now,job,id,revision,id),
 this.q('UPDATE reservations SET expires=?,blocked=? WHERE report_id=? AND EXISTS(SELECT 1 FROM reports WHERE id=? AND revision=? AND last_op=?)',now+1800000,input.submit?1:0,id,id,next,job),
 this.q('INSERT INTO outbox(id,report_id,revision,created_at) SELECT ?,id,revision,? FROM reports WHERE id=? AND revision=? AND last_op=?',job,now,id,next,job),
 this.q('INSERT INTO audit(id,report_id,revision,actor,action,payload,created_at) SELECT ?,id,revision,?,?,?,? FROM reports WHERE id=? AND revision=? AND last_op=?',job,'contributor',input.submit?'submit':'save',JSON.stringify({note,category}),now,id,next,job)]);if(!results[0].meta.changes)throw new AppError('El borrador ha cambiado. Vuelve a cargarlo.');return this.get(id,credential);}
}
