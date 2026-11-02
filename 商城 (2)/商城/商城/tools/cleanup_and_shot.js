// tools/cleanup_and_shot.js — 自启 IDE → 删脏图片消息 → 重新截正常/表情态
const path=require('path');const{spawn}=require('child_process');const Automator=require('miniprogram-automator');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CLI='D:\\weixinkaifa\\微信web开发者工具\\cli.bat';const projectPath=path.join(__dirname,'..');
const PORT=9440;const OUT='D:/商城/.workbuddy/tmp';

async function start(){return new Promise((res,rej)=>{const p=spawn('cmd.exe',['/c',CLI,'auto','--project',projectPath,'--auto-port',String(PORT)],{detached:true,stdio:'ignore',windowsHide:true});p.on('error',rej);p.unref();res();});}
async function conn(){
  const dl=Date.now()+120000;
  let last='';
  while(Date.now()<dl){
    try{return await Automator.connect({wsEndpoint:'ws://localhost:'+PORT,timeout:60000});}
    catch(e){last=e.message;await sleep(2000);}
  }
  throw new Error('connect timeout: '+last);
}

(async()=>{
  console.log('启 IDE 端口',PORT,'…');
  await start();
  console.log('等 IDE 就绪后连接 …');
  const mp=await conn();
  console.log('✅ connected');
  mp.on('disconnect',()=>console.log('  [事件] disconnected'));

  // 1. 触发自动登录（小程序首次启动调 login 云函数 + 编译需要时间）
  await mp.reLaunch('/pages/chat/chat');await sleep(18000);
  let ch=await mp.currentPage();
  let list=((await ch.data()).list)||[];
  if(!list.length){console.log('首读 0 会话，再等 10s …');await sleep(10000);ch=await mp.currentPage();list=((await ch.data()).list)||[];}
  if(!list.length){console.log('再等 10s …');await sleep(10000);ch=await mp.currentPage();list=((await ch.data()).list)||[];}
  if(!list.length){console.log('❌ 仍无会话（自动登录可能未完成或项目未加载）');await mp.disconnect();process.exit(1);}
  const conv=list[0];const peer=(conv.participants||[]).find(p=>p)||'';
  console.log('进入会话:',conv._id);

  // 2. 进 chatroom 找图片消息
  await mp.reLaunch(`/pages/chatroom/chatroom?convId=${conv._id}&peer=${peer}&goodsId=${conv.goodsId||''}`);await sleep(4500);
  let page=await mp.currentPage();
  const d=await page.data();
  const msgs=d.messages||[];
  const images=msgs.filter(m=>m.isImage||m.type==='image');
  console.log('消息总数:',msgs.length,'图片消息数:',images.length);
  images.forEach((m,i)=>console.log(`  img[${i}] _id=${m._id} createdAt=${m.createdAt}`));

  // 3. 删图片
  for(const im of images){
    console.log(`\n→ 删除图片 ${im._id}`);
    try{const r=await page.callMethod('_adminDeleteMessage',im._id);console.log('  结果:',JSON.stringify(r));}
    catch(e){console.log('  ❌ delete fail:',e.message);}
  }
  await sleep(1500);

  // 4. 重新进 chatroom 并截两张图
  await mp.reLaunch(`/pages/chatroom/chatroom?convId=${conv._id}&peer=${peer}&goodsId=${conv.goodsId||''}`);await sleep(4500);
  page=await mp.currentPage();
  const d2=await page.data();
  console.log('\n清理后消息数:',(d2.messages||[]).length,'图片消息数:',(d2.messages||[]).filter(m=>m.isImage||m.type==='image').length);
  console.log('goods.cover:',(d2.goods&&d2.goods.cover)||'(空)');
  console.log('defaultCover:',d2.defaultCover);
  await mp.screenshot({path:OUT+'/after_normal.png'});console.log('📷 after_normal.png');

  // 5. 打开表情面板
  await page.setData({showEmoji:true,showPlus:false});await sleep(1000);
  page=await mp.currentPage();
  await mp.screenshot({path:OUT+'/after_emoji.png'});console.log('📷 after_emoji.png');
  await page.setData({showEmoji:false,showPlus:false});

  await mp.disconnect();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});