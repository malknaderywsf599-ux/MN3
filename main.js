const $ = id => document.getElementById(id);
const msg = t => $('bootmsg').textContent = t;
const prog = p => $('barfill').style.width = Math.min(100,p) + '%';

function loadScript(src){
  return new Promise((ok,no)=>{ const s=document.createElement('script');
    s.src=src; s.onload=ok; s.onerror=()=>no(new Error('فشل تحميل '+src)); document.head.appendChild(s); });
}

async function main(){
  const term = new Terminal({ fontSize:14, cursorBlink:true, convertEol:false,
    theme:{ background:'#0b0d0c', foreground:'#d7e3d0', cursor:'#8fd18a' } });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit); term.open($('term')); fit.fit();
  addEventListener('resize', ()=>fit.fit());

  try{
    msg('تحميل المحاكي...'); await loadScript(CFG.libv86);
    // تأكد إن صورة Linux موجودة قبل ما نبدأ
    const head = await fetch(CFG.bzimage,{method:'HEAD'});
    if(!head.ok) throw new Error('صورة Linux مش موجودة: '+CFG.bzimage+' ('+head.status+') - شوف README');

    const emu = new V86({
      wasm_path: CFG.wasm,
      memory_size: CFG.memoryMB*1024*1024,
      vga_memory_size: 2*1024*1024,
      bios:{url:CFG.bios}, vga_bios:{url:CFG.vgabios},
      bzimage:{url:CFG.bzimage},
      cmdline: CFG.cmdline,
      autostart:true, disable_keyboard:true, disable_mouse:true
    });
    window.emu = emu;

    emu.add_listener('download-progress', e=>{
      if(e.total){ prog(e.loaded/e.total*100); msg('تحميل: '+e.file_name.split('/').pop()); }
    });

    // مخرجات Linux -> الشاشة (بنجمّع البايتات ونكتبها كل frame)
    let buf=[];
    emu.add_listener('serial0-output-byte', b=>{ buf.push(b); });
    (function flush(){ if(buf.length){ term.write(new Uint8Array(buf)); buf=[]; } requestAnimationFrame(flush); })();

    let booted=false;
    emu.add_listener('serial0-output-byte', ()=>{ if(!booted){ booted=true; $('boot').classList.add('hide'); } });

    // الكتابة -> Linux
    const send = s => emu.serial0_send(s);
    term.onData(d => send(applyCtrl(d)));
    buildKeys(send, ()=>term.focus());
    term.onResize(({cols,rows})=>{ // عرّف Linux بحجم الشاشة
      send(`stty cols ${cols} rows ${rows}\n`.replace(/^/,'')); });
    term.focus();
  }catch(e){
    msg('خطأ: '+e.message);
    $('bar').style.display='none';
  }
}
main();
