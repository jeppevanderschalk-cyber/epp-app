(function(root){
  function summarize(slots){
    const groups=new Map(),format=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam'});
    for(const slot of slots||[]){
      const date=new Date(slot.starts_at);if(Number.isNaN(date.valueOf()))continue;
      const day=format.format(date),row=groups.get(day)||{day,slots:0,maxShooters:0,free:0,blocked:0};
      const capacity=Math.max(0,Number(slot.capacity)||0),booked=Math.max(0,Number(slot.booked)||0);
      row.slots++;row.maxShooters+=slot.blocked?Math.min(capacity,booked):capacity;
      row.free+=slot.blocked?0:Math.max(0,capacity-booked);if(slot.blocked)row.blocked++;
      groups.set(day,row);
    }
    return [...groups.values()].sort((a,b)=>a.day.localeCompare(b.day));
  }
  const api={summarize};root.EppPlannerCapacity=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
