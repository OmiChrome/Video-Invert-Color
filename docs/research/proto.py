import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W,H=480,270
WR=np.array([0.2126,0.7152,0.0722])
try: F=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",22)
except: F=ImageFont.load_default()
def board(bg,ink):
    im=Image.new("RGB",(W,H),bg); d=ImageDraw.Draw(im)
    for i,(t,c) in enumerate([("F = m a",ink[0]),("E = mc^2  (red)",ink[1]),("v = u + at (blue)",ink[2]),("green note",ink[3])]):
        d.text((30,30+i*55),t,fill=c,font=F)
    d.ellipse((330,150,450,250),outline=ink[1],width=4)
    return np.asarray(im)/255.
white=board((245,245,240),[(20,20,20),(200,30,30),(30,60,200),(20,140,60)])
black=board((25,30,28),[(235,235,230),(240,120,120),(140,170,255),(120,220,140)])
gray=board((128,128,128),[(20,20,20),(200,30,30),(30,60,200),(20,140,60)])
mixed=white.copy(); mixed[:, 300:]=np.asarray(Image.fromarray((black*255).astype(np.uint8)).resize((W,H)))[:, :180]/255.*0.6
mixed[150:250,320:460]=[0.75,0.6,0.5]  # face-ish blob in dark camera region
frames={"whiteboard":white,"blackboard":black,"mid-gray":gray,"mixed slide+camera":mixed}
luma=lambda c:(c*WR).sum(-1)
def matrix(c,a,b,s=1.0):
    Y=luma(c)[...,None]; return np.clip(s*c+(a+(b-s)*Y),0,1)
def naive(c): return 1-c
def css_hue(c):  # invert(1) hue-rotate(180deg) per Filter Effects spec matrices
    c=1-c; import math; ca,sa=math.cos(math.pi),math.sin(math.pi)
    M=np.array([[0.213+ca*0.787-sa*0.213,0.715-ca*0.715-sa*0.715,0.072-ca*0.072+sa*0.928],
                [0.213-ca*0.213+sa*0.143,0.715+ca*0.285+sa*0.140,0.072-ca*0.072-sa*0.283],
                [0.213-ca*0.213-sa*0.787,0.715-ca*0.715+sa*0.715,0.072+ca*0.928+sa*0.072]])
    return np.clip(c@M.T,0,1)
YT,YCAP=0.06,0.80
def stats(c):
    small=np.asarray(Image.fromarray((c*255).astype(np.uint8)).resize((32,18),Image.BILINEAR))/255.
    Y=luma(small).ravel(); return np.median(Y),np.percentile(Y,5),np.percentile(Y,95)
def params(Yb,lo,hi):
    if Yb>0.5:   # bright background -> invert polarity, anchor bg at YT
        b=-(YCAP-YT)/max(Yb-0.0,0.2); a=YT-b*Yb
    else:        # dark background -> keep polarity, just cap highlights
        b=min(1.0,(YCAP-YT)/max(1.0-Yb,0.2)); a=YT-b*Yb if Yb>YT else 0.0
    return a,b
def adaptive(c):
    a,b=params(*stats(c)); return matrix(c,a,b)
def local(c):
    inv=matrix(c,*params(0.95,0,0)); keep=matrix(c,*params(0.05,0,0))
    Y=Image.fromarray((luma(c)*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18))
    B=np.asarray(Y)/255.; m=np.clip((B-0.35)/0.25,0,1); m=m*m*(3-2*m)
    return inv*m[...,None]+keep*(1-m[...,None])
algos=[("original",lambda c:c),("naive invert",naive),("CSS invert+hue180",css_hue),("luma invert (YCbCr)",lambda c:matrix(c,1,-1)),("adaptive global",adaptive),("adaptive local (blur mask)",local)]
rows=[]; report=[]
for fn,fr in frames.items():
    tiles=[]
    for an,f in algos:
        o=f(fr); Y=luma(o); report.append(f"{fn:20s} {an:28s} meanY={Y.mean():.3f} p95Y={np.percentile(Y,95):.3f}")
        t=Image.fromarray((o*255).astype(np.uint8)); ImageDraw.Draw(t).text((5,H-18),an,fill=(255,0,255)); tiles.append(t)
    row=Image.new("RGB",(W*len(algos),H)); [row.paste(t,(i*W,0)) for i,t in enumerate(tiles)]; rows.append(row)
sheet=Image.new("RGB",(W*len(algos),H*len(rows)))
for i,r in enumerate(rows): sheet.paste(r,(0,i*H))
sheet.save("comparison.png"); print("\n".join(report))
