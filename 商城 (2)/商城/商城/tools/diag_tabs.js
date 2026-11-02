// tools/diag_tabs.js — 用 element.handle 拿每个 tab 真实几何
const path=require('path');const{spawn}=require('child_process');const Automator=require('miniprogram-automator');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CLI='D:\\weixinkaifa\\微信web开发者工具\\cli.bat';const projectPath=path.join(__dirname,'..');const PORT=9427;
async function start(){return new Promise((res,rej)=>{const p=spawn('cmd.exe',['/c',CLI,'auto','--project',projectPath,'--auto-port',String(PORT)],{detached:true,stdio:'ignore',windowsHide:true});p.on('error',rej);p.unref();res();});}
async function conn(){const dl=Date.now()+90000;while(Date.now()<dl){try{return await Automator.connect({wsEndpoint:'ws://localhost:'+PORT,timeout:60000});}catch(e){await sleep(1500);}}throw new Error('timeout');}

(async()=>{
  await start();const mp=await conn();
  await mp.reLaunch('/pages/chat/chat');await sleep(3000);
  const ch=await mp.currentPage();const list=((await ch.data()).list)||[];
  if(!list.length){console.log('no conv');process.exit(1);}
  const conv=list[0];const peer=(conv.participants||[]).find(p=>p)||'';
  await mp.reLaunch(`/pages/chatroom/chatroom?convId=${conv._id}&peer=${peer}&goodsId=${conv.goodsId||''}`);await sleep(3500);
  let page=await mp.currentPage();
  await page.setData({showEmoji:true,showPlus:false});await sleep(1000);
  page=await mp.currentPage();

  // tabs 容器
  const tabsEl = await page.$('.emoji-tabs');
  const tc = await tabsEl.size();
  const to = await tabsEl.offset();
  console.log('emoji-tabs container: top=',Math.round(to.top),' left=',Math.round(to.left),' w=',Math.round(tc.width),' h=',Math.round(tc.height));

  // 每个 tab 的真实几何（element.handle）
  const tabs = await page.$$('text.emoji-tab');
  console.log('tabs 数量:',tabs.length);
  const tabInfo=[];
  for(let i=0;i<tabs.length;i++){
    const sz=await tabs[i].size();const off=await tabs[i].offset();
    const txt=(await tabs[i].text()).trim();
    const cls=(await tabs[i].attribute('class'))||'';
    const active=cls.includes('active');
    tabInfo.push({i,txt,active,left:Math.round(off.left),top:Math.round(off.top),right:Math.round(off.left+sz.width),bottom:Math.round(off.top+sz.height),w:Math.round(sz.width)});
    console.log(`  tab[${i}] "${txt}" active=${active} left=${tabInfo[i].left} right=${tabInfo[i].right} w=${tabInfo[i].w}`);
  }

  // scroll-left via attribute
  const sleft = await tabsEl.attribute('scroll-left').catch(()=>null);
  console.log('\nemoji-tabs scroll-left attr=', sleft);

  // emoji-scroll 内部 grid
  const gridEl=await page.$('.emoji-grid');
  const gsz=await gridEl.size();const goff=await gridEl.offset();
  console.log('emoji-grid: top=',Math.round(goff.top),' left=',Math.round(goff.left),' w=',Math.round(gsz.width),' h=',Math.round(gsz.height));
  const emojis=await page.$$('text.emoji-item');
  console.log('emoji-item 数量:',emojis.length);
  if(emojis.length){
    const e0=await emojis[0].size();const o0=await emojis[0].offset();
    console.log(`  first emoji: "${(await emojis[0].text()).trim()}" left=${Math.round(o0.left)} top=${Math.round(o0.top)} w=${Math.round(e0.width)} h=${Math.round(e0.height)}`);
    const eL=await emojis[emojis.length-1].size();const oL=await emojis[emojis.length-1].offset();
    console.log(`  last  emoji: "${(await emojis[emojis.length-1].text()).trim()}" left=${Math.round(oL.left)} top=${Math.round(oL.top)}`);
  }

  // 整图
  await mp.screenshot({path:'D:/商城/.workbuddy/tmp/layout_zoom.png'});
  console.log('📷 layout_zoom.png');

  // 判定
  console.log('\n=== 判定 ===');
  const cLeft=Math.round(to.left), cRight=Math.round(to.left+tc.width);
  for(const t of tabInfo){
    if(t.left < cLeft-1) console.log(`  ❌ "${t.txt}"(active=${t.active}) left=${t.left} < 容器左=${cLeft} → 被滚出`);
    else if(t.right > cRight+1) console.log(`  ❌ "${t.txt}" right=${t.right} > 容器右=${cRight} → 被滚出`);
    else if(t.active) console.log(`  ✅ active "${t.txt}" 在 [${cLeft},${cRight}]`);
  }

  await mp.disconnect();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});