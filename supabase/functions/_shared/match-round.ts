export async function ensureMatchRound(db: any, eventId: string, ensureSingle: any) {
  const {data: rounds, error}=await db.from('rounds').select('*').eq('event_id',eventId).limit(2);
  if(error)throw error;
  if(rounds?.length>1)throw new Error('wedstrijd_meerdere_rondes');
  if(rounds?.length===1)return rounds[0];
  // The unique event/label constraint lets simultaneous trainers reuse one row.
  return ensureSingle(db,'rounds',{event_id:eventId,label:'Ronde 1'},{event_id:eventId,label:'Ronde 1'});
}
