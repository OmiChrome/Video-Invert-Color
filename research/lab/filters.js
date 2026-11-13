// Night Owl filters. Shared by the extension and the research lab.
// Everything here is plain SVG filter markup: the browser runs it on the GPU for every video frame,
// so no JavaScript runs while the video plays.
'use strict';

// Rec.709 luma weights (what YouTube uses), the darkest output (background) and the default text brightness.
const OWL_W = [0.2126, 0.7152, 0.0722];
const OWL_DARK = 0.06;

// Hue-safe brightness flip: Y' = cap - (cap - dark)·Y, colour (chroma) kept as it is.
// c' = c + (a + (b - 1)·Y)  with a = cap, b = -(cap - dark).  One 4×5 colour matrix.
function owlInvertMatrix(cap) {
  const a = cap, k = -(cap - OWL_DARK) - 1, [r, g, b] = OWL_W.map(w => +(k * w).toFixed(4));
  return `${1 + r} ${g} ${b} 0 ${a}  ${r} ${1 + g} ${b} 0 ${a}  ${r} ${g} ${1 + b} 0 ${a}  0 0 0 0 1`;
}

const OWL_DIM = `<feComponentTransfer>
  <feFuncR type="gamma" amplitude="0.6" exponent="1.25"/><feFuncG type="gamma" amplitude="0.6" exponent="1.25"/><feFuncB type="gamma" amplitude="0.6" exponent="1.25"/>
</feComponentTransfer>`;

// Smart board.
// 1. Find "board" pixels: colourless and not dark.
// 2. One blur gives, for every spot, how much of the neighbourhood is board (coverage)
//    and the board's local brightness (works for white, grey and unevenly lit boards).
// 3. Divide the picture by that local brightness, so any board becomes pure white, then flip brightness.
// 4. Apply the flip only where the neighbourhood is board. Near the board edge, flip only board pixels and
//    strongly coloured diagram pixels, so a face next to the board stays natural.
// 5. Everything else (faces, photos, blackboards, dark slides) is only dimmed.
function owlSmartFilter(id, cap) {
  return `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox">
  <feColorMatrix in="SourceGraphic" result="ycc" type="matrix" values="0.2126 0.7152 0.0722 0 0  -0.3189 -1.0728 1.3917 0 0.5  1.1811 -1.0728 -0.1083 0 0.5  0 0 0 1 0"/>
  <feComponentTransfer in="ycc" result="parts">
    <feFuncR type="table" tableValues="0 0 0 0.3 0.8 1 1 1 1 1 1"/>
    <feFuncG type="table" tableValues="0 0 0 0 0 0 0 0 0.3 0.9 1 0.9 0.3 0 0 0 0 0 0 0 0"/>
    <feFuncB type="table" tableValues="0 0 0 0 0 0 0 0 0.3 0.9 1 0.9 0.3 0 0 0 0 0 0 0 0"/>
  </feComponentTransfer>
  <feColorMatrix in="parts" result="boardA" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 1 1 0 -2"/>
  <feColorMatrix in="parts" result="boardC" type="matrix" values="1 1 1 0 -2  1 1 1 0 -2  1 1 1 0 -2  0 0 0 0 1"/>
  <feColorMatrix in="SourceGraphic" result="luma" type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"/>
  <feComposite in="luma" in2="boardA" operator="in" result="weighted"/>
  <feGaussianBlur in="weighted" result="local" stdDeviation="0.035 0.06"/>
  <feComponentTransfer in="local" result="coreParts">
    <feFuncR type="table" tableValues="0 0 0 0 0.2 0.8 1 1 1 1 1"/>
    <feFuncG type="table" tableValues="0 0 0 0 0.2 0.8 1 1 1 1 1"/>
    <feFuncB type="table" tableValues="0 0 0 0 0.2 0.8 1 1 1 1 1"/>
    <feFuncA type="table" tableValues="0 0 0 0.1 0.5 0.85 1 1 1 1 1"/>
  </feComponentTransfer>
  <feFlood flood-color="#000" flood-opacity="1" result="black"/>
  <feComposite in="coreParts" in2="black" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="core"/>
  <feComponentTransfer in="local" result="bgLevel">
    <feFuncR type="table" tableValues="0.4 0.4 0.4 0.4 0.4 0.5 0.6 0.7 0.8 0.9 1"/>
  </feComponentTransfer>
  <feColorMatrix in="bgLevel" result="bgHole" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1 0 0 0 1"/>
  <feComposite in="SourceGraphic" in2="bgHole" operator="arithmetic" k1="0" k2="1" k3="-1" k4="0" result="divided"/>
  <feColorMatrix in="divided" result="inv" class="owl-inv" type="matrix" values="${owlInvertMatrix(cap)}"/>
  <feComponentTransfer in="ycc" result="chromaParts">
    <feFuncR type="linear" slope="0" intercept="0"/>
    <feFuncG type="table" tableValues="1 1 1 1 0.5 0 0 0 0 0 0 0 0 0 0 0 0.5 1 1 1 1"/>
    <feFuncB type="table" tableValues="1 1 1 1 0.5 0 0 0 0 0 0 0 0 0 0 0 0.5 1 1 1 1"/>
  </feComponentTransfer>
  <feColorMatrix in="chromaParts" result="colourful" type="matrix" values="0 1 1 0 0  0 1 1 0 0  0 1 1 0 0  0 0 0 0 1"/>
  <feComposite in="boardC" in2="colourful" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="flippable"/>
  <feGaussianBlur in="core" result="coreWide" stdDeviation="0.06 0.1"/>
  <feComponentTransfer in="coreWide" result="near">
    <feFuncR type="table" tableValues="0 0.7 1 1 1 1 1 1 1 1 1"/><feFuncG type="table" tableValues="0 0.7 1 1 1 1 1 1 1 1 1"/><feFuncB type="table" tableValues="0 0.7 1 1 1 1 1 1 1 1 1"/>
    <feFuncA type="linear" slope="0" intercept="1"/>
  </feComponentTransfer>
  <feComposite in="near" in2="flippable" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="nearFlip"/>
  <feComposite in="core" in2="nearFlip" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="msum"/>
  <feColorMatrix in="msum" result="mask" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0"/>
  ${OWL_DIM.replace('<feComponentTransfer>', '<feComponentTransfer in="SourceGraphic" result="dim">')}
  <feComposite in="inv" in2="mask" operator="in" result="invM"/>
  <feComposite in="dim" in2="mask" operator="out" result="dimM"/>
  <feComposite in="invM" in2="dimM" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
</filter>`;
}

// All filters in one hidden <svg>. Modes: smart (default), invert, dim. Warm tint is chained after any of them.
function owlFilterSvg(cap = 0.8) {
  return `<svg xmlns="http://www.w3.org/2000/svg" id="owl-filters" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none">
<defs>
${owlSmartFilter('owl-smart', cap)}
<filter id="owl-invert" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1"><feColorMatrix class="owl-inv" type="matrix" values="${owlInvertMatrix(cap)}"/></filter>
<filter id="owl-dim" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1">${OWL_DIM}</filter>
<filter id="owl-warm" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0.82 0 0 0  0 0 0.55 0 0  0 0 0 1 0"/></filter>
</defs></svg>`;
}

// CSS filter value for a mode.
function owlFilterCss(mode, warm) {
  return `url(#owl-${mode})${warm ? ' url(#owl-warm)' : ''}`;
}
