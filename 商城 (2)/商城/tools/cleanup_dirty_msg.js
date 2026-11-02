// tools/cleanup_dirty_msg.js
// 1) 进 chatroom 找到那张脏图片消息（type=image，通常就是测试残留）
// 2) 调 chat.deleteMessage 删掉它
// 3) 重新进 chatroom 并截正常态/表情态两张图，确认「布局不对」的真凶被清掉
const path=require('path');const{spawn}=require('child_process');const Automator=require('miniprogram-automator');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CLI='D:\\weixinkaifa\\微信web开发者工具\\cli.bat';const projectPath=path.join(__dirname,'..');const PORT=9430;const OUT='D:/商城/.workbuddy/tmp';

// 复用已在 9420 监听的 IDE（deploy CLI 留下的实例），不重新启动
async function conn(){
  const dl=Date.now()+90000;
  while(Date.now()<dl){
    try{return await Automator.connect({wsEndpoint:'ws://localhost:9420',timeout:60000});}
    catch(e){console.log('  connect retry …',e.message);await sleep(2000);}
  }
  throw new Error('connect timeout');
}
(async()=>{
  console.log('连 IDE ws://localhost:9420 …');
  const mp=await conn();console.log('✅ connected');
  await mp.reLaunch('/pages/chat/chat');await sleep(7000);   // 等编译 + 自动登录 + 拉会话
  const ch=await mp.currentPage();
  let list=((await ch.data()).list)||[];
  if(!list.length){
    console.log('首读无会话，等 4s 再试 …');
    await sleep(4000);
    list=((await ch.data()).list)||[];
  }
  if(!list.length){console.log('no conv');process.exit(1);}
  const conv=list[0];const peer=(conv.participants||[]).find(p=>p)||'';
  await mp.reLaunch(`/pages/chatroom/chatroom?convId=${conv._id}&peer=${peer}&goodsId=${conv.goodsId||''}`);await sleep(3500);
  let page=await mp.currentPage();

  // 1) 找脏图片消息
  const d=await page.data();
  const msgs=d.messages||[];
  console.log('消息总数:',msgs.length);
  const images=msgs.filter(m=>m.isImage||m.type==='image');
  console.log('图片消息数:',images.length);
  images.forEach((m,i)=>console.log(`  img[${i}] _id=${m._id} content前缀=${(m.content||'').slice(0,60)}... createdAt=${m.createdAt}`));

  // 2) 删掉每张图片（这里基本只有 1 张；多张会全删以便彻底清理）
  for(const im of images){
    console.log(`\n删除图片 ${im._id} …`);
    try{
      const r=await page.callMethod('__delMsg', im._id);
      console.log('  结果:', JSON.stringify(r));
    }catch(e){console.log('  ❌ delete fail:', e.message);}
  }

  // 3) 等删除生效 + 刷新
  await sleep(1500);
  await mp.reLaunch(`/pages/chatroom/chatroom?convId=${conv._id}&peer=${peer}&goodsId=${conv.goodsId||''}`);await sleep(4000);
  page=await mp.currentPage();
  const d2=await page.data();
  console.log('\n清理后消息数:',(d2.messages||[]).length,'图片消息数:',(d2.messages||[]).filter(m=>m.isImage||m.type==='image').length);
  console.log('goods:', JSON.stringify(d2.goods));

  // 4) 截正常态
  await mp.screenshot({path:OUT+'/after_normal.png'});
  console.log('📷 after_normal.png');

  // 5) 打开表情面板再截一张
  await page.setData({showEmoji:true,showPlus:false});await sleep(1000);
  page=await mp.currentPage();
  await mp.screenshot({path:OUT+'/after_emoji.png'});
  console.log('📷 after_emoji.png');

  // 复位
  await page.setData({showEmoji:false,showPlus:false});
  await mp.disconnect();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});