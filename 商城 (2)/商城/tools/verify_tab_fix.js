// tools/verify_tab_fix.js — 启动 IDE → 进 chatroom → 开 emoji 面板 → 截图 tabs 特写 + 量几何
const path=require('path');const{spawn}=require('child_process');const Automator=require('miniprogram-automator');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CLI='D:\\weixinkaifa\\微信web开发者工具\\cli.bat';const projectPath=path.join(__dirname,'..');
const PORT=9450;const OUT='D:/商城/.workbuddy/tmp';

async function start(){return new Promise((res,rej)=>{const p=spawn('cmd.exe',['/c',CLI,'auto','--project',projectPath,'--auto-port',String(PORT)],{detached:true,stdio:'ignore',windowsHide:true});p.on('error',rej);p.unref();res();});}
async function conn(){const dl=Date.now()+120000;let last='';while(Date.now()<dl){try{return await Automator.connect({wsEndpoint:'ws://localhost:'+PORT,timeout:60000});}catch(e){last=e.message;await sleep(2000);}}throw new Error('connect timeout: '+last);}

(async()=>{
  console.log('启 IDE 端口',PORT,'…');
  await start();
  const mp=await conn();console.log('✅ connected');
  mp.on('disconnect',()=>console.log('  [事件] disconnected'));
  const errors=[];const logs=[];
  mp.on('console',m=>{const t=m.args.join(' ');if(m.type==='error')errors.push(t);else logs.push(t);});
  mp.on('exception',e=>errors.push(e.message||JSON.stringify(e)));

  // 先 reLaunch 到首页触发 app.onLaunch(login)，再进聊天列表
  await mp.reLaunch('/pages/index/index');await sleep(20000);
  // 再去聊天列表
  await mp.reLaunch('/pages/chat/chat');await sleep(10000);
  let ch=await mp.currentPage();
  let list=((await ch.data()).list)||[];
  if(!list.length){console.log('再等 10s …');await sleep(10000);ch=await mp.currentPage();list=((await ch.data()).list)||[];}
  console.log('控制台错误:',errors.length,'条');
  errors.slice(0,5).forEach(e=>console.log('  ❌',e.slice(0,150)));
  if(!list.length){console.log('❌ 仍无会话');await mp.disconnect();process.exit(1);}
  const conv=list[0];const peer=(conv.participants||[]).find(p=>p)||'';

  // 进 chatroom，开 emoji
  await mp.reLaunch(`/pages/chatroom/chatroom?convId=${conv._id}&peer=${peer}&goodsId=${conv.goodsId||''}`);await sleep(4000);
  let page=await mp.currentPage();
  await page.setData({showEmoji:true,showPlus:false});await sleep(1000);
  page=await mp.currentPage();

  // 截全图
  await mp.screenshot({path:OUT+'/fix_emoji_full.png'});console.log('📷 fix_emoji_full.png');

  // 量 tabs 几何
  const tabsEl=await page.$('.emoji-tabs');
  const tc=await tabsEl.size();const to=await tabsEl.offset();
  console.log('\nemoji-tabs 容器: left=',Math.round(to.left),' w=',Math.round(tc.width));

  const tabs=await page.$$('text.emoji-tab');
  console.log('tabs:',tabs.length);
  for(let i=0;i<tabs.length;i++){
    const sz=await tabs[i].size();const off=await tabs[i].offset();
    const txt=(await tabs[i].text()).trim();
    const cls=(await tabs[i].attribute('class'))||'';
    const active=cls.includes('active');
    console.log(`  tab[${i}] "${txt}" active=${active} left=${Math.round(off.left)} right=${Math.round(off.left+sz.width)} w=${Math.round(sz.width)}`);
  }

  // 裁剪 tabs 区域的截图（用 element screenshot）
  const tabEl=await page.$('.emoji-tabs');
  if(tabEl){
    try{
      await tabEl.screenshot({path:OUT+'/fix_emoji_tabs.png'});
      console.log('📷 fix_emoji_tabs.png (特写)');
    }catch(e){console.log('element screenshot 不可用:',e.message);}
  }

  // 判定：第一个 tab 文字宽度 vs tab 内宽（padding 之内）
  if(tabs.length>=1){
    const t0=tabs[0];
    const sz=await t0.size();const off=await t0.offset();
    // 在 430px 视口，1rpx≈0.573px；padding 8rpx 16rpx→左右各 16rpx≈9.2px
    const paddingX=16*0.573*2; // 约 18.4px
    const innerW=sz.width-paddingX;
    console.log(`\n判定: tab[0] width=${Math.round(sz.width)} 内宽(去 padding)≈${innerW.toFixed(1)}px`);
    console.log('  修复前: 内宽≈54-27.5=26.5px，"笑脸"≈30px → 超出被裁');
    console.log('  修复后: 内宽≈?px（待实测）→ 若 ≥30px 则文字完整');
  }

  await mp.disconnect();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});