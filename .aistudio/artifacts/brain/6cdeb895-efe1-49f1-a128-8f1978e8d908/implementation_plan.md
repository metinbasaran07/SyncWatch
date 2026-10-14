# CineSync: Yüksek Kaliteli Eşzamanlı İzleme, Bas-Konuş & Vercel Uyumlu Platform

Düşük gecikmeli ve yüksek bit-rate video senkronizasyonu, 1080p/60fps kalitesinde harici film/sekme paylaşımı, tuş kontrollü Bas-Konuş (Push-to-Talk) ses/kamera iletişimi, ayarlanabilir kamera boyutları ve Vercel platformuna %100 uyumlu mimari.

### Kullanıcı Revizyonu ve Yeni İstekler

> [!IMPORTANT]
> Kullanıcının eklediği yeni gereksinimler:
> 1. **Ayarlanabilir Kamera Boyutu**: Katılımcı kameralarının boyutunun serbestçe ayarlanabilmesi (Kompakt, Normal, Sinematik Büyük ve yüzdelik boyut ölçekleyici). İstenildiğinde tek tıkla gizlenebilme veya sinema moduna geçebilme.
> 2. **Vercel Yayınına Tam Uyum**: Vercel Serverless ortamının kısıtlamalarına (uzun süreli kalıcı soket bağlantısı sınırlamaları) karşı hem AI Studio / Cloud Run ortamında yerel WebSocket, hem de Vercel üzerinde sorunsuz çalışan akıllı hibrit sinyalleşme ve `vercel.json` / statik Vite yapılandırması.

---

## 1. Genel Bakış ve Temel Konsept

**CineSync**, arkadaşların Netflix, YouTube veya harici web sitelerinden 1080p yüksek kalitede film izleyebildiği, birbirini ayarlanabilir kamera pencereleriyle görebildiği ve bas-konuş ile film keyfini bozmadan iletişim kurabildiği modern bir izleme ortamıdır.

- **Özelleştirilebilir Kamera Boyutlandırması**: İzleyicinin tercihine göre mini/kompakt, standart, büyük boy veya slider ile serbest ölçeklendirilebilen kamera şeridi.
- **Kusursuz Senkronizasyon (Öncelikli)**: YouTube, doğrudan video bağlantıları (MP4/HLS) ve sekme ekran paylaşımında düşük gecikme ve otomatik drift düzeltmesi.
- **Vercel Dağıtımına Hazır**: `vercel.json`, standart Vite derleme yapılandırması (`dist`) ve Vercel Functions / WebRTC sinyalleşme uyumluluğu.

---

## 2. Kullanıcı Deneyimi ve Arayüz Tasarımı

### A. Ayarlanabilir Kamera Düzeni
- **Boyut Seçici (Kamera Kontrol Çubuğu)**:
  - *Kompakt (120px)*: Filmi ön plana çıkaran zarif mini kameralar.
  - *Standart (180px)*: Dengeli sinema ve sohbet modu.
  - *Geniş (260px)*: Arkadaşların tepkilerini net görmeyi sağlayan büyük pencereler.
  - *Serbest Boyut Ölçekleyici (Slider)*: %50 ile %150 arasında canlı boyutlandırma.
- **Konum Seçimi**: Ekranın alt şeridi veya sağ yan paneli arasında geçiş.
- **Tek Tıkla Gizle / Göster**: Filmde heyecanlı anlarda tek tıkla kameraları tamamen gizleyip tam sahneye geçebilme.

### B. Bas-Konuş (Push-to-Talk) & Ses Kontrolü
- `[Space]` veya `[V]` tuşuna basılı tutarak anında konuşma, tuş bırakılınca mutlak sessizlik.
- Ekranda basılı tutulabilen dokunmatik/fare PTT düğmesi.
- Aktif konuşmacının kamera kutusunda ses dalgası ve renkli sınır ışıması.

### C. Yüksek Kaliteli Ekran Paylaşımı (Netflix & Siteler)
- `getDisplayMedia` ile 1080p60 akış ve `contentHint: "motion"`.
- Stereo sistem sesi aktarımı (`echoCancellation: false`, `noiseSuppression: false`).

---

## 3. Vercel Dağıtım Mimarisi & Sinyalleşme Stratejisi

> [!NOTE]
> Vercel standart sunucusuz (serverless) fonksiyonlarda kalıcı TCP/WebSocket oturumları 15-60 saniye sonra zaman aşımına uğrayabilir. Bu nedenle platform **hibrit sinyalleşme katmanı** ile tasarlanmıştır:

1. **Geliştirme / Cloud Run Modu**: Doğrudan Express + WebSocket (`ws`) sunucusu (düşük gecikmeli yerel test).
2. **Vercel Dağıtım Modu**:
   - WebRTC eşler arası doğrudan veri ve medya kanalları (P2P Mesh).
   - Sinyalleşme için hafif HTTP polling / SSE veya WebRTC bağlantı paylaşımı (Oda token'ı ile anlık el sıkışma).
   - Proje kökünde `vercel.json` (Vite build çıktısı `dist` ve API yönlendirmeleri).

### `vercel.json` Yapılandırması:
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

---

## 4. Teknik Mimari ve Bileşen Şeması

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CineSync Full-Stack App                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
┌───────────────────────┐                         ┌──────────────────────┐
│  React Frontend UI    │ ◄── Hybrid Signaling ─► │ Node Backend / API   │
│  - CinemaStage (Sync) │                         │ - Room State         │
│  - 1080p ScreenShare  │                         │ - WebRTC Signaling   │
│  - Resizable Camera   │                         │ - E2EE Chat Relay    │
│  - Push-to-Talk Key   │                         │ - Vercel Serverless  │
│  - E2EE Chat Panel    │                         │   Ready              │
└──────────┬────────────┘                         └──────────────────────┘
           │
           ▼
┌───────────────────────┐
│ WebRTC Peer Mesh      │
│ - 60fps Motion Video  │
│ - Stereo System Audio │
│ - Push-To-Talk Mic    │
└───────────────────────┘
```

---

## 5. Uygulama Adımları

1. **Vercel ve Derleme Yapılandırması**:
   - `vercel.json` oluşturulması, `package.json` build betiklerinin tam uyumlu hale getirilmesi.
2. **Kriptografi & Güvenlik (`src/services/crypto.ts`)**:
   - AES-GCM ve PBKDF2 uçtan uca şifreleme.
3. **Hibrit Sinyalleşme & WebRTC Motoru (`src/services/webrtc.ts`)**:
   - P2P mesh kamera, ses ve 1080p60 ekran paylaşımı.
   - Bas-konuş mantığı ve ses seviyesi analizörü.
4. **Ayarlanabilir Kamera Şeridi (`src/components/CameraGrid.tsx`)**:
   - Slider ve hazır boyut butonları (Kompakt, Normal, Geniş).
   - Konuşmacı vurgusu, bireysel ses seviyesi ayarları, kamerayı simge durumuna küçültme.
5. **Sinema Sahnesi & Video Senkronizasyonu (`src/components/CinemaStage.tsx`)**:
   - YouTube IFrame API, doğrudan MP4/video ve yüksek çözünürlüklü ekran yayını.
   - Oynat/durdur/ileri sar senkronizasyonu ve drift eşitleyici.
6. **Şifreli Canlı Sohbet Paneli (`src/components/ChatPanel.tsx`)**:
   - Canlı mesajlaşma ve sinema emoji reaksiyonları.
7. **İkincil / Tamamlayıcı: Film Öneri & Keşif Modülü**:
   - İkincil sekme olarak film keşif alanı.

---

## 6. Doğrulama ve Kabul Kriterleri

- [ ] **Ayarlanabilir Kameralar**: Kamera boyutları kullanıcı tarafından büyütülüp küçültülebilmeli, kapatılıp açılabilmeli.
- [ ] **Vercel Uyumluluğu**: Proje `npm run build` ile `dist` klasörüne temiz şekilde derlenebilmeli, Vercel'e atıldığında doğrudan çalışacak yapıda olmalı.
- [ ] **1080p Kalite**: Sekme ve ekran yayını yüksek çözünürlükte ve bozulmasız iletilmeli.
- [ ] **Bas-Konuş**: Space/V tuşuyla mikrofon yalnızca basıldığında aktif olmalı.
- [ ] **Senkronizasyon**: Odadaki tüm kullanıcılar videoyu milisaniyelik uyumla izleyebilmeli.
