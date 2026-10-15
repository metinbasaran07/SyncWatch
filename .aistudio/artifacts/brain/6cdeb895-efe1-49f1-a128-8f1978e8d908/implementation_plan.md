# CineSync Teknik Altyapı Yenileme Planı (Pure Firebase Firestore)

Kullanıcının talebi ve yanıtları doğrultusunda, arayüzün (UI) tüm tasarımı ve görsel zenginliği birebir korunurken; karmaşık ve cihazlar arası senkronizasyon kopukluğuna yol açan eski WebSocket/hibrit teknik altyapı tamamen sıfırlanıp yerine **Saf Firebase Firestore Gerçek Zamanlı Mimarisi** kurulacaktır.

---

## 1. Mimari Genel Bakış ve Hedefler

1. **Tamamen Güvenilir Çoklu Cihaz Desteği:**
   - 1. kişi bilgisayarından veya telefonundan oda oluşturduğunda Firestore üzerinde benzersiz 6 haneli oda kodu üretilir.
   - 2. kişi (başka bir cihazdan, farklı ağdan veya mobil internetten) bu 6 haneli kodu girerek veya paylaşılan linke (`?room=123456`) tıklayarak anında odaya katılır.
   - Her iki cihaz da Firestore `onSnapshot` gerçek zamanlı dinleyicileriyle tek ve tutarlı bir durum (Single Source of Truth) üzerinden haberleşir.

2. **Video Eşzamanlaması (Playback Sync):**
   - Oynat/Durdur, saniye sarma ve video değiştirme eylemleri Firestore'daki `rooms/{roomId}` belgesine yazılır.
   - Oynatma zamanı `currentTime` ve `updatedAt` ile senkronize edilerek ağ gecikmelerinden bağımsız mikrosaniye hassasiyetinde senkron sağlanır.

3. **Gerçek Zamanlı Sohbet ve Katılımcı Listesi:**
   - `rooms/{roomId}/messages` alt koleksiyonu ile anlık mesajlaşma.
   - `rooms/{roomId}/participants` alt koleksiyonu ile o an odada kimlerin olduğu, mikrofon/kamera durumları ve host yetkileri anlık güncellenir.
   - Sayfa kapatıldığında veya bağlantı koptuğunda temizleme (heartbeat / presence).

4. **WebRTC Ses & Görüntü İletişimi (Firestore Tabanlı Sinyalleşme):**
   - Karmaşık ve sunucu düşmelerine açık WebSocket relay yerine, Firestore `rooms/{roomId}/signals` alt koleksiyonu üzerinden ICE candidate ve SDP offer/answer değişimi yapılır (Google STUN sunucuları kullanılarak).
   - Böylece ek bir sunucu bağımlılığı olmaksızın cihazlar doğrudan peer-to-peer bağlanır.

5. **Arayüzün Korunması:**
   - Üst Menü (Header), Sinema Sahnesi (Cinema Stage & Ambient Glow), Video Oynatıcı, Katılımcı Paneli, Sohbet Çekmecesi, Oda Paylaşım Penceresi ve Oda Oluşturma/Katılma modalları aynı kalacak; sadece arkadaki teknik bağlayıcılar (state handlers) temizlenecektir.

---

## 2. Adım Adım Uygulama Planı

### Aşama 1: Veritabanı Modeli ve Güvenlik Kuralları
- **`firestore.rules` Güncellemesi:**
  - Tüm cihazların (anonim auth veya misafir oturumu) `rooms`, `participants`, `messages`, `signals`, `reactions` koleksiyonlarına gecikmesiz ve kesintisiz okuma/yazma yapabilmesi sağlanır.
  - Kurallar `DeployRules` RPC ile deploy edilir.
- **Veri Tipleri (`src/types.ts`):**
  - Room, Participant, VideoState, ChatMessage, WebRTCSignal tipleri net ve tip güvenli şekilde güncellenir.

### Aşama 2: Çekirdek Servis Katmanının Sıfırlanması
- **`src/services/firebaseRoomService.ts` (Yeni Temiz Çekirdek):**
  - `createRoom(name, hostName, password)`: 6 haneli benzersiz kodla oda açma.
  - `joinRoom(roomId, userName, password)`: Odaya güvenli katılım, şifre doğrulaması.
  - `subscribeToRoom(roomId, callback)`: Video durumu ve oda ayarlarını anlık dinleme.
  - `updateVideoState(roomId, videoState)`: Oynat, durdur, ileri/geri sarma, video URL değiştirme.
  - `subscribeToParticipants(roomId, callback)`: Canlı katılımcı senkronizasyonu.
  - `sendMessage(roomId, message)` & `subscribeToMessages(roomId, callback)`: Gerçek zamanlı sohbet.
  - `sendSignal(roomId, signal)` & `subscribeToSignals(roomId, myId, callback)`: WebRTC sinyalleşmesi.
  - `leaveRoom(roomId, participantId)`: Odadan ayrılma ve temizlik.

### Aşama 3: WebRTC Katmanının Firestore Sinyalleşmesine Taşınması
- **`src/services/webrtcFirestore.ts`:**
  - WebSocket bağımlılığı kaldırılıp Firestore signals koleksiyonu üzerinden peer bağlantıları yönetilir.
  - Kamera ve mikrofon açma/kapama, ekran paylaşımı ve ses/görüntü akışları sıfırdan hatasız hale getirilir.

### Aşama 4: Arayüz Entegrasyonu (`App.tsx`, `Header.tsx`, `RoomModal.tsx`, `VideoPlayer.tsx`, vb.)
- UI bileşenlerinin tasarımı bozulmadan:
  - Eski `socket.ts` bağımlılığı tamamen kaldırılır.
  - Odanın oluşturulması, başka cihazdan 6 haneli kodla veya doğrudan linkle katılımı kusursuz hale getirilir.
  - Video oynatıldığında diğer cihazda anında oynaması sağlanır; döngüsel (infinite loop) tetiklenmeler engellenir.
  - Test ve derleme doğrulaması yapılır.

---

## 3. Doğrulama ve Test Kriterleri
1. **Derleme ve Kod Kalitesi:** `compile_applet` ve `lint_applet` ile sıfır hata doğrulaması.
2. **Oda Açma Testi:** 1. kullanıcının 6 haneli oda koduyla odayı sorunsuz açabilmesi.
3. **Farklı Cihazdan Katılım Testi:** 2. kullanıcının doğrudan link (`?room=123456`) veya kod girişi ile odaya hemen dahil olabilmesi.
4. **Gerçek Zamanlı Senkron:** Video duraklatıldığında veya süre değiştirildiğinde 2. ekranda da anında senkronize olması.
