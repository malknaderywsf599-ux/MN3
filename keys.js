// شريط الأزرار السفلي (زي Termux)
const KEYS = [
  ['ESC','\x1b'],['TAB','\t'],['CTRL','ctrl'],['^C','\x03'],['^D','\x04'],['^L','\x0c'],
  ['↑','\x1b[A'],['↓','\x1b[B'],['←','\x1b[D'],['→','\x1b[C'],
  ['/','/'],['-','-'],['|','|'],['~','~'],['_','_'],['HOME','\x1b[H'],['END','\x1b[F'],['PgUp','\x1b[5~'],['PgDn','\x1b[6~']
];
let ctrlOn = false;
function buildKeys(send, focus){
  const box = document.getElementById('keys');
  KEYS.forEach(([label,seq])=>{
    const b = document.createElement('button'); b.textContent = label;
    b.addEventListener('pointerdown', e=>{
      e.preventDefault();
      if(seq==='ctrl'){ ctrlOn=!ctrlOn; b.classList.toggle('on',ctrlOn); return; }
      send(seq); focus();
    });
    box.appendChild(b);
  });
}
// لو CTRL مفعّل: الحرف الجاي يتحول لـ Ctrl+حرف
function applyCtrl(d){
  if(!ctrlOn || d.length!==1) return d;
  ctrlOn=false; document.querySelector('#keys .on')?.classList.remove('on');
  const c=d.toLowerCase().charCodeAt(0);
  return (c>=97&&c<=122)? String.fromCharCode(c-96) : d;
}
