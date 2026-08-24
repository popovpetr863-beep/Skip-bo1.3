const express=require('express');
const path=require('path');
const http=require('http');
const {Server}=require('socket.io');

const app=express();
const server=http.createServer(app);
const io=new Server(server);
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(req,res)=>res.json({ok:true,game:'skipbo'}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/room/:code',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

const rooms=new Map();
const MAX_PLAYERS=4;
const STOCK_SIZE=30;
const HAND_SIZE=5;
const BUILDING_COUNT=4;
const sh=a=>{const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]]}return x};
const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const code=()=>{let c;do c=Math.random().toString(36).slice(2,7).toUpperCase();while(rooms.has(c));return c};
function roomOf(id){for(const r of rooms.values())if(r.players.some(p=>p.id===id))return r}
function getP(r,id){return r.players.find(p=>p.id===id)}
function createRoom(s,name){const r={code:code(),host:s.id,players:[player(s.id,name)],started:false,turn:0,phase:'lobby',deck:[],completed:[],buildings:Array.from({length:BUILDING_COUNT},()=>[]),log:[],winner:null};rooms.set(r.code,r);s.join(r.code);return r}
function player(id,name){return {id,name:(name||'Игрок').slice(0,20),stock:[],hand:[],discards:[[],[],[],[]]}}
function makeDeck(){const d=[];for(let n=1;n<=12;n++)for(let i=0;i<12;i++)d.push({id:uid(),value:n,wild:false});for(let i=0;i<18;i++)d.push({id:uid(),value:0,wild:true});return sh(d)}
function draw(r,n){const out=[];while(out.length<n){if(!r.deck.length){if(!r.completed.length)break;r.deck=sh(r.completed.splice(0));}const c=r.deck.pop();if(c)out.push(c)}return out}
function drawToFive(r,p){const need=Math.max(0,HAND_SIZE-p.hand.length);if(need){p.hand.push(...draw(r,need));return need}return 0}
function aliveStockTop(p){return p.stock[p.stock.length-1]||null}
function topDiscard(p,i){return p.discards[i]?.[p.discards[i].length-1]||null}
function cardValueForBuilding(card,building){const next=building.length+1;if(!card)return null;if(card.wild)return next;return card.value}
function canPlay(card,building){if(!card)return false;const next=building.length+1;if(next>12)return false;return card.wild||card.value===next}
function publicCard(c,face=false){return face?{id:c.id,value:c.value,wild:c.wild,face:true}:{id:c.id,face:false}}
function publicPlayer(p,self=false){return {id:p.id,name:p.name,stockCount:p.stock.length,stockTop:p.stock.length?publicCard(p.stock[p.stock.length-1],true):null,hand:self?p.hand.map(c=>publicCard(c,true)):[],discards:p.discards.map(a=>a.map((c,i)=>publicCard(c,i===a.length-1))),};}
function snap(r,id){const me=getP(r,id);return {code:r.code,game:'skipbo',host:r.host,started:r.started,turn:r.turn,phase:r.phase,winner:r.winner,players:r.players.map(p=>publicPlayer(p,p.id===id)),me:publicPlayer(me,true),deckCount:r.deck.length,buildings:r.buildings.map(a=>a.map(c=>publicCard(c,true))),completedCount:r.completed.length,log:r.log.slice(-80)};}
function send(r){r.players.forEach(p=>io.to(p.id).emit('state',snap(r,p.id)))}
function log(r,msg){r.log.push(msg);if(r.log.length>100)r.log.shift()}
function nextTurn(r){r.turn=(r.turn+1)%r.players.length;const p=r.players[r.turn];drawToFive(r,p);log(r,`🔄 Ход игрока ${p.name}.`)}
function checkWinner(r){const p=r.players[r.turn];if(p&&p.stock.length===0){r.started=false;r.phase='finished';r.winner=p.name;log(r,`🏆 ${p.name} победил! Все карты его стопки закончились.`);return true}return false}
function startGame(r){
 if(r.players.length<2||r.players.length>MAX_PLAYERS)return;
 r.deck=makeDeck();r.completed=[];r.buildings=Array.from({length:BUILDING_COUNT},()=>[]);r.winner=null;r.log=[];
 r.players.forEach(p=>{p.stock=draw(r,STOCK_SIZE);p.hand=[];p.discards=[[],[],[],[]]});
 r.turn=0;r.started=true;r.phase='play';
 drawToFive(r,r.players[r.turn]);
 log(r,`🎴 Игра началась. У каждого игрока по ${STOCK_SIZE} карт в стопке.`);
 log(r,`▶️ Первый ход: ${r.players[r.turn].name}.`);
 send(r);
}
function findSource(p,source,index,cardId){
 if(source==='hand')return p.hand.find(c=>c.id===cardId)||null;
 if(source==='stock'){const c=aliveStockTop(p);return c&&c.id===cardId?c:null}
 if(source==='discard'){const i=Number(index);const c=topDiscard(p,i);return c&&c.id===cardId?c:null}
 return null;
}
function removeSource(p,source,index,cardId){
 if(source==='hand'){const i=p.hand.findIndex(c=>c.id===cardId);if(i>=0)return p.hand.splice(i,1)[0]}
 if(source==='stock'){if(p.stock.at(-1)?.id===cardId)return p.stock.pop()}
 if(source==='discard'){const a=p.discards[Number(index)];if(a?.at(-1)?.id===cardId)return a.pop()}
 return null;
}
function maybeContinueOrEnd(r,p){
 if(checkWinner(r))return;
 if(p.hand.length===0){const n=drawToFive(r,p);if(n)log(r,`🃏 ${p.name} сыграл все 5 карт и добрал ${n} новых.`)}
 send(r);
}
function playCard(r,p,{source,index,cardId,building}){
 if(!r.started||r.players[r.turn]?.id!==p.id||r.phase!=='play')return;
 const b=Number(building);if(!Number.isInteger(b)||b<0||b>=BUILDING_COUNT)return;
 const card=findSource(p,source,index,cardId);if(!card||!canPlay(card,r.buildings[b]))return;
 const played=removeSource(p,source,index,cardId);if(!played)return;
 r.buildings[b].push(played);
 const pile=r.buildings[b];
 log(r,`✨ ${p.name} сыграл ${played.wild?'SKIP-BO':played.value} на центральную стопку ${b+1}.`);
 if(pile.length===12){r.completed.push(...pile.splice(0));log(r,`🏁 Центральная стопка ${b+1} завершена и убрана в сброс.`)}
 maybeContinueOrEnd(r,p);
}
function discard(r,p,{cardId,pile}){
 if(!r.started||r.players[r.turn]?.id!==p.id||r.phase!=='play')return;
 if(p.hand.length===0)return;
 const i=Number(pile);if(!Number.isInteger(i)||i<0||i>=4)return;
 const c=p.hand.find(x=>x.id===cardId);if(!c)return;
 p.hand=p.hand.filter(x=>x.id!==cardId);p.discards[i].push(c);
 log(r,`🗂️ ${p.name} завершил ход сбросом карты в стопку ${i+1}.`);
 if(p.stock.length===0){r.started=false;r.phase='finished';r.winner=p.name;log(r,`🏆 ${p.name} победил!`);send(r);return}
 nextTurn(r);send(r);
}
io.on('connection',s=>{
 s.on('create',({name},cb)=>{const r=createRoom(s,name);cb?.({ok:true,code:r.code});send(r)});
 s.on('join',({name,code:c},cb)=>{const r=rooms.get(String(c||'').toUpperCase());if(!r)return cb?.({ok:false,error:'Комната не найдена'});if(r.started)return cb?.({ok:false,error:'Игра уже началась'});if(r.players.length>=MAX_PLAYERS)return cb?.({ok:false,error:`Максимум ${MAX_PLAYERS} игрока`});r.players.push(player(s.id,name));s.join(r.code);cb?.({ok:true,code:r.code});send(r)});
 s.on('start',()=>{const r=roomOf(s.id);if(r&&r.host===s.id&&!r.started)startGame(r)});
 s.on('playCard',data=>{const r=roomOf(s.id);if(r)playCard(r,getP(r,s.id),data||{})});
 s.on('discard',data=>{const r=roomOf(s.id);if(r)discard(r,getP(r,s.id),data||{})});
 s.on('disconnect',()=>{const r=roomOf(s.id);if(!r)return;r.players=r.players.filter(p=>p.id!==s.id);if(!r.players.length)rooms.delete(r.code);else{if(r.host===s.id)r.host=r.players[0].id;if(r.turn>=r.players.length)r.turn=0;send(r)}});
});
server.listen(process.env.PORT||3000,'0.0.0.0');
