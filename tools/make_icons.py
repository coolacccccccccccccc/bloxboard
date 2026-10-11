import zlib, struct, sys
def png(path, size):
    S = 4  # supersample
    N = size * S
    acc = [[0.0]*size for _ in range(size)]
    accw = [[0.0]*size for _ in range(size)]
    r = N * 0.22
    def inside_round(x, y, x0, y0, x1, y1, rad):
        cx = min(max(x, x0+rad), x1-rad); cy = min(max(y, y0+rad), y1-rad)
        return (x-cx)**2 + (y-cy)**2 <= rad*rad
    # tiles: 2x2 board, top-right tile accent-light (a "live" tile)
    g = N*0.2; gap = N*0.07; t = (N - 2*g - gap)/2
    tiles = [(g, g, 1), (g+t+gap, g, 2), (g, g+t+gap, 1), (g+t+gap, g+t+gap, 1)]
    img = []
    for py in range(size):
        row = []
        for px in range(size):
            cols = []
            for sy in range(S):
                for sx in range(S):
                    x = px*S+sx+0.5; y = py*S+sy+0.5
                    if not inside_round(x, y, 0, 0, N, N, r): cols.append(None); continue
                    c = (74, 85, 232)
                    for tx, ty, k in tiles:
                        if inside_round(x, y, tx, ty, tx+t, ty+t, t*0.22):
                            c = (255, 255, 255) if k == 1 else (53, 201, 141)
                    cols.append(c)
            filled = [c for c in cols if c]
            a = len(filled)/len(cols)
            if filled:
                rgb = tuple(int(sum(c[i] for c in filled)/len(filled)) for i in range(3))
            else:
                rgb = (0, 0, 0)
            row.append(rgb + (int(a*255),))
        img.append(row)
    raw = b''.join(b'\x00' + bytes(v for p in row for v in p) for row in img)
    def chunk(tag, data): return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag+data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
for s in (16, 48, 128):
    png(f'icons/{s}.png', s)
