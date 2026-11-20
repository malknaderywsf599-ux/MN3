// عدّل الروابط هنا لو أي ملف ماتحملش (404)
const CFG = {
  libv86: 'https://cdn.jsdelivr.net/npm/v86@latest/build/libv86.js',
  wasm:   'https://cdn.jsdelivr.net/npm/v86@latest/build/v86.wasm',
  bios:    'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/seabios.bin',
  vgabios: 'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/vgabios.bin',
  // صورة Linux: نزّلها وحطها جوه images/ في الـ repo (شوف README)
  bzimage: 'images/buildroot-bzimage.bin',
  cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on console=ttyS0',
  memoryMB: 128
};
