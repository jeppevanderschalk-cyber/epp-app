export async function trainingJournal(db:any,actor:any,body:any){
 if(!['journal_load','journal_add'].includes(body.action))return null;
 if(typeof body.shooterId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.shooterId)||typeof body.trainingId!=='string'||!body.trainingId.trim()||body.trainingId.length>150)throw Error('ongeldige_training');
 const {data:profile,error}=await db.from('shooters').select('id,linked_user_id').eq('id',body.shooterId).maybeSingle();if(error)throw error;
 if(!profile?.linked_user_id)throw Error('geen_toegang');
 const own=profile.linked_user_id===actor.id;
 const {data:member,error:memberError}=await db.from('app_accounts').select('club_code,active,membership_approved,deleted_at').eq('id',profile.linked_user_id).maybeSingle();if(memberError)throw memberError;
 if(!member?.active||member.deleted_at||member.membership_approved===false||(!actor.is_platform_admin&&member.club_code!==actor.club_code)||(!own&&actor.role!=='trainer'))throw Error('geen_toegang');
 const club=member.club_code;
 if(body.action==='journal_add'){
  if(typeof body.content!=='string'||!body.content.trim()||body.content.trim().length>4000)throw Error('ongeldige_notitie');
  // A shooter's entries are always private. Only trainers can share advice.
  const visibility=actor.role==='trainer'?'trainer':'private';
  const {error:insertError}=await db.from('epp_training_journal').insert({club_code:club,shooter_id:profile.id,training_id:body.trainingId,author_id:actor.id,author_name:actor.display_name,visibility,content:body.content.trim()});if(insertError)throw insertError;
 }
 let query=db.from('epp_training_journal').select('id,training_id,author_id,author_name,visibility,content,created_at').eq('club_code',club).eq('shooter_id',profile.id).eq('training_id',body.trainingId);
 // Trainers cannot retrieve private shooter notes, including via export.
 query=own?query.or('visibility.eq.trainer,author_id.eq.'+actor.id):query.eq('visibility','trainer');
 const rows:any[]=[];
 for(let offset=0;;offset+=1000){const {data,error}=await query.order('created_at').order('id').range(offset,offset+999);if(error)throw error;rows.push(...data);if(data.length<1000)break;}
 return {ok:true,entries:rows};
}
