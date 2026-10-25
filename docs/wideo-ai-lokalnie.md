# Własne wideo AI do tła: za darmo, na Twoim komputerze

Program **ComfyUI** z modelem **Wan 2.2 (5B)** generuje krótkie klipy wideo lokalnie.
Nic nie kosztuje poza prądem, ale wymaga odpowiedniej karty graficznej.

## Czy Twój komputer da radę?

- **Karta NVIDIA z min. 8 GB pamięci (VRAM)**, np. RTX 3060, 4060 i nowsze. Według dokumentacji ComfyUI model 5B
  mieści się w 8 GB dzięki przenoszeniu części danych do zwykłej pamięci RAM.
- 16 GB RAM lub więcej, ok. 25 GB wolnego miejsca na dysku.
- Na karcie AMD/Intel albo z mniej niż 8 GB VRAM będzie bardzo wolno albo wcale. Zostań wtedy przy darmowych klipach
  z `media/README.md`.

Model sprawdzisz tak: Menedżer zadań → Wydajność → GPU, gdzie widać nazwę karty i „Dedykowana pamięć GPU”.

## Instalacja (jednorazowo)

1. Pobierz **ComfyUI Desktop** dla Windows ze strony https://www.comfy.org/download i zainstaluj.
2. Uruchom ComfyUI. Przy pierwszym starcie wybierz kartę NVIDIA (CUDA).
3. Otwórz **Templates** (szablony), wyszukaj **„Wan2.2 5B”** i wybierz szablon `video_wan2_2_5B_ti2v`.
4. ComfyUI zaproponuje pobranie brakujących modeli. Zgódź się (to kilkanaście GB, potrwa).
   Pliki według dokumentacji ComfyUI:
   - `diffusion_models/wan2.2_ti2v_5B_fp16.safetensors`
   - `text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`
   - `vae/wan2.2_vae.safetensors`

## Najlepszy sposób: ożyw obraz z Canvy

Model potrafi zamienić **obraz w wideo**. Weź swoje `tlo.jpg` z Canvy jako pierwszą klatkę,
wtedy wideo będzie pasować do reszty HUD.

1. W szablonie wczytaj obraz w węźle **Load Image** (`media/tlo.jpg`).
2. W polu opisu (prompt) wklej jeden z poniższych tekstów, po angielsku, bo model lepiej go rozumie.
3. Na karcie z 8 GB zacznij od mniejszej rozdzielczości (np. 832×480) i krótkiej długości
   (pole `length` w węźle `Wan22ImageToVideoLatent`). Jeśli pojawi się błąd pamięci,
   zmniejszaj po jednym parametrze naraz.
4. Kliknij **Run**. Gotowy plik znajdziesz w folderze `output` ComfyUI.
   Skopiuj go do `jarvis-hud/media/` jako `tlo.mp4`.

### Gotowe opisy (prompty)

**Warsztat, delikatny ruch kamery**
```
Slow cinematic dolly forward through a dark high-tech workshop at night, volumetric haze drifting,
faint blue light shafts, tiny dust particles floating, subtle flicker of distant screens,
calm, smooth, no people, no text, seamless loop feeling
```

**Hologramy w powietrzu**
```
Translucent ice-blue holographic panels and thin glowing rings slowly rotating in a dark room,
soft bloom, particles drifting, gentle parallax, cinematic, smooth slow motion, no text, no people
```

**Abstrakcyjne tło danych**
```
Dark navy space filled with slow drifting glowing data particles and faint network lines,
soft depth of field, subtle light sweeps, calm and minimal, smooth loop, no text
```

Dodatkowo, jako „negative prompt” (czego unikać):
```
text, letters, logo, watermark, people, faces, bright white background, fast motion, flicker, low quality
```

## Płynne zapętlenie (opcjonalnie)

Krótki klip może „skakać” na końcu pętli. Najprościej zrobić z niego ping-pong (do przodu i wstecz)
darmowym programem **ffmpeg** (`winget install Gyan.FFmpeg`):

```
ffmpeg -i wideo.mp4 -filter_complex "[0:v]reverse[r];[0:v][r]concat=n=2:v=1[v]" -map "[v]" -an -c:v libx264 -preset veryfast -crf 23 tlo.mp4
```

Źródła: [Dokumentacja ComfyUI: Wan 2.2](https://docs.comfy.org/tutorials/video/wan/wan2_2),
[wymagania VRAM dla Wan 2.2](https://book.st-hakky.com/en/data-science/wan2-2-vram-recommended-config).
