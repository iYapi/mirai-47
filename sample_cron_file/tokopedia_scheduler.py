"""
Script Tokopedia Scraper dengan Sistem Persistent Browser (Login Akun) & Scheduler.

Cara Penggunaan:
1. Jalankan login pertama kali agar sesi tersimpan:
   python tokopedia_scheduler.py --login
   (Jendela browser akan terbuka, silakan login ke akun Tokopedia Anda secara manual.
    Setelah masuk, tekan ENTER di terminal ini untuk menutup dan menyimpan sesi).

2. Untuk melakukan pemindaian (scrape) secara langsung saat ini juga (debug/refresh cepat):
   python tokopedia_scheduler.py --now

3. Untuk menjalankan sistem penjadwalan otomatis (menunggu jam tertentu):
   python tokopedia_scheduler.py --schedule
   (Default akan berjalan setiap hari pada pukul 01:00 pagi secara otomatis).
"""

import os
import sys
import json
import time
import random
import argparse
from datetime import datetime
from playwright.sync_api import sync_playwright

# ------------------ CONFIG: Silakan sesuaikan kebutuhan Anda ------------------
SEARCH_URL = "https://www.tokopedia.com/search?navsource=home&q=rtx+3050&source=universe&st=product"
MAX_PAGES = 3                  # Batas maksimum segmen/iterasi scrolling
SCHEDULE_TIME = "01:00"         # Format HH:MM (Jam:Menit) untuk pencarian terjadwal harian
HEADLESS = False                # Set True jika ingin proses berjalan di latar belakang (tanpa jendela browser)
USER_DATA_DIR = "./tokopedia_profile"  # Direktori penyimpan profil/session cookie login
# -------------------------------------------------------------------------------

# Selector Tokopedia terkini
PRODUCT_CARD_SELECTOR = "div[data-testid='divSRPContentProducts'] > div > div > div"
NAME_SELECTOR = "span[class*='tnoqZ'], div[class*='SzILj'] span"
PRICE_SELECTOR = "div[class*='urMOI']"
ORIGINAL_PRICE_SELECTOR = "div[class*='e48Km'] span, span[class*='hC1B']"
DISCOUNT_PERCENT_SELECTOR = "span[class*='_7UCYd']"
RATING_SELECTOR = "span[class*='_2NfJx']"
SOLD_SELECTOR = "span[class*='u6Sfj']"
SHOP_BADGE_SELECTOR = "img[alt='shop badge']"


def clean_price(price_raw: str | None) -> int | None:
    """Ubah 'Rp1.250.000' jadi 1250000 (integer)."""
    if not price_raw:
        return None
    digits = "".join(ch for ch in price_raw if ch.isdigit())
    return int(digits) if digits else None


def clean_rating(rating_raw: str | None) -> float | None:
    """Ubah '4.8' jadi 4.8 (float)."""
    if not rating_raw:
        return None
    try:
        return float(rating_raw.strip().replace(",", "."))
    except ValueError:
        return None


def clean_sold_count(sold_raw: str | None) -> int | None:
    """Ubah '100+ terjual' atau '1,5 rb terjual' jadi nilai integer bersih."""
    if not sold_raw:
        return None
    s = sold_raw.lower().strip()
    s = s.replace("terjual", "").replace("+", "").strip()
    
    multiplier = 1
    if "rb" in s or "k" in s:
        multiplier = 1000
        s = s.replace("rb", "").replace("k", "").strip()
        
    s = s.replace(",", ".")
    try:
        val = float(s.split()[0])
        return int(val * multiplier)
    except (ValueError, IndexError):
        return None


def scroll_to_bottom(page, card_selector: str, name_selector: str, btn_selector: str):
    """Scroll ke bawah terus menerus dengan jeda acak sampai tombol 'Muat Lebih Banyak' terlihat atau tidak ada produk baru yang dimuat."""
    # Arahkan kursor mouse ke tengah layar agar event gulir diterima oleh kontainer produk
    page.mouse.move(500, 500)
    time.sleep(0.5)
    
    last_count = 0
    same_count_limit = 10  # Batas maksimum scroll tanpa ada penambahan produk baru
    same_count_runs = 0
    scroll_idx = 1
    
    while True:
        # Cek apakah tombol "Muat Lebih Banyak" sudah muncul di DOM dan terlihat di layar
        btn = page.query_selector(btn_selector)
        if btn and btn.is_visible():
            print(f"  [Scroll {scroll_idx}] Tombol 'Muat Lebih Banyak' terdeteksi aktif. Berhenti scrolling.")
            break
            
        # Lakukan gulir ke bawah
        page.mouse.wheel(0, 1000)
        page.keyboard.press("PageDown")
        
        # Jeda acak (random delay) sesuai permintaan untuk menyamarkan bot
        delay = random.uniform(1.2, 2.6)
        time.sleep(delay)
        
        # Hitung produk termuat (bukan skeleton)
        cards = page.query_selector_all(card_selector)
        loaded_cards = [c for c in cards if c.query_selector(name_selector)]
        current_count = len(loaded_cards)
        
        print(f"  [Scroll {scroll_idx}] Kartu terdeteksi: {len(cards)}, Kartu termuat: {current_count} (Jeda scroll: {delay:.2f}s)")
        
        if current_count > last_count:
            last_count = current_count
            same_count_runs = 0
        else:
            same_count_runs += 1
            
        # Jika tidak ada produk baru termuat setelah beberapa kali scroll, kemungkinan ujung halaman tercapai
        if same_count_runs >= same_count_limit:
            print(f"  [Scroll {scroll_idx}] Tidak ada produk baru termuat setelah {same_count_limit} kali scroll. Ujung halaman tercapai.")
            break
            
        scroll_idx += 1


def manual_login():
    """Membuka browser headed agar user bisa masuk/login ke akun Tokopedia secara manual."""
    print("\n=================== MODE LOGIN MANUAL ===================")
    print("Membuka browser Tokopedia dengan profil persistent...")
    print("1. Silakan login ke akun Tokopedia Anda secara manual di jendela browser yang terbuka.")
    print("2. Setelah sukses masuk/login, kembali ke terminal ini.")
    print("3. Tekan [ENTER] di terminal ini untuk menutup browser dan menyimpan sesi Anda.")
    print("=========================================================\n")
    
    os.makedirs(USER_DATA_DIR, exist_ok=True)
    
    with sync_playwright() as p:
        # Gunakan browser headed agar user bisa berinteraksi
        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            headless=False,
            args=["--disable-http2", "--disable-blink-features=AutomationControlled"],
            ignore_default_args=["--enable-automation"],
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://www.tokopedia.com")
        
        input("\nTekan [ENTER] di sini setelah Anda selesai login...")
        context.close()
        print("\nSesi login berhasil disimpan ke:", os.path.abspath(USER_DATA_DIR))


def scrape_tokopedia(base_url: str, max_pages: int, run_headless: bool) -> list[dict]:
    results = []
    scraped_urls = set()

    print(f"Menggunakan profil login dari: {os.path.abspath(USER_DATA_DIR)}")
    
    with sync_playwright() as p:
        launch_args = ["--disable-http2", "--disable-blink-features=AutomationControlled"]
        if run_headless:
            launch_args.append("--headless=new")
            
        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            headless=False,  # Harus False untuk --headless=new di Chromium asli
            args=launch_args,
            ignore_default_args=["--enable-automation"],
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        
        page = context.pages[0] if context.pages else context.new_page()

        print(f"Membuka halaman: {base_url}")
        try:
            page.goto(base_url, timeout=30000)
        except Exception as e:
            print(f"Gagal memuat halaman utama: {e}")
            context.close()
            return results

        # Tunggu kontainer produk pertama kali muncul
        container_selector = "div[data-testid='divSRPContentProducts']"
        try:
            page.wait_for_selector(container_selector, timeout=15000)
        except Exception:
            print("Kontainer produk tidak ditemukan. Mengakhiri pencarian.")
            context.close()
            return results

        for loop_idx in range(1, max_pages + 1):
            print(f"\n[Iterasi {loop_idx}/{max_pages}] Memproses pemuatan dan scrolling produk...")
            
            btn_selector = 'button:has-text("Muat Lebih Banyak")'
            scroll_to_bottom(page, PRODUCT_CARD_SELECTOR, NAME_SELECTOR, btn_selector)

            # Ambil seluruh kartu produk saat ini
            cards = page.query_selector_all(PRODUCT_CARD_SELECTOR)
            new_cards_count = 0

            for card in cards:
                try:
                    # Ambil elemen tautan untuk deduplikasi data
                    link_el = card.query_selector("a")
                    product_url = link_el.get_attribute("href") if link_el else None
                    
                    if product_url:
                        clean_url = product_url.split("?")[0]
                        if clean_url in scraped_urls:
                            continue
                        scraped_urls.add(clean_url)
                    else:
                        name_el = card.query_selector(NAME_SELECTOR)
                        fallback_name = name_el.inner_text().strip() if name_el else None
                        if not fallback_name or fallback_name in scraped_urls:
                            continue
                        scraped_urls.add(fallback_name)

                    name_el = card.query_selector(NAME_SELECTOR)
                    price_el = card.query_selector(PRICE_SELECTOR)
                    orig_price_el = card.query_selector(ORIGINAL_PRICE_SELECTOR)
                    discount_pct_el = card.query_selector(DISCOUNT_PERCENT_SELECTOR)
                    rating_el = card.query_selector(RATING_SELECTOR)
                    sold_el = card.query_selector(SOLD_SELECTOR)
                    badge_el = card.query_selector(SHOP_BADGE_SELECTOR)

                    product_name = name_el.inner_text().strip() if name_el else None
                    active_price_raw = price_el.inner_text().strip() if price_el else None
                    slashed_price_raw = orig_price_el.inner_text().strip() if orig_price_el else None
                    discount_percentage = discount_pct_el.inner_text().strip() if discount_pct_el else None
                    rating = rating_el.inner_text().strip() if rating_el else None
                    sold_count = sold_el.inner_text().strip() if sold_el else None

                    if slashed_price_raw:
                        original_price = slashed_price_raw
                        discount_price = active_price_raw
                    else:
                        original_price = active_price_raw
                        discount_price = None

                    store_name = None
                    store_location = None
                    spans = card.query_selector_all("span[class*='flip']")
                    if len(spans) >= 2:
                        store_name = spans[0].inner_text().strip()
                        store_location = spans[1].inner_text().strip()
                    elif len(spans) == 1:
                        store_name = spans[0].inner_text().strip()

                    store_el = card.query_selector("span[class*='si3CN']")
                    if store_el:
                        store_name = store_el.inner_text().strip()

                    store_type = "Regular Merchant"
                    if badge_el:
                        badge_url = badge_el.get_attribute("src") or ""
                        if "official_store" in badge_url or "badge_os" in badge_url:
                            store_type = "Official Store"
                        elif "goldmerchant" in badge_url or "power_merchant" in badge_url:
                            store_type = "Power Merchant"

                    results.append({
                        "product_name": product_name,
                        "original_price": original_price,
                        "original_price_cleaned": clean_price(original_price),
                        "discount_price": discount_price,
                        "discount_price_cleaned": clean_price(discount_price),
                        "discount_percentage": discount_percentage,
                        "rating": rating,
                        "rating_cleaned": clean_rating(rating),
                        "sold_count": sold_count,
                        "sold_count_cleaned": clean_sold_count(sold_count),
                        "store_name": store_name,
                        "store_location": store_location,
                        "store_type": store_type,
                        "source": "tokopedia",
                        "page": loop_idx,
                        "scraped_at": datetime.now().isoformat(),
                    })
                    new_cards_count += 1
                except Exception as e:
                    print(f"Gagal parsing satu kartu produk: {e}")
                    continue

            print(f"Berhasil memproses {new_cards_count} produk baru pada segmen ini. (Total keseluruhan: {len(results)})")

            if new_cards_count == 0:
                print("Tidak ada produk baru ditemukan (ujung hasil pencarian tercapai). Berhenti.")
                break

            if loop_idx >= max_pages:
                print("Mencapai limit iterasi pemuatan maksimum. Selesai.")
                break

            btn_selector = 'button:has-text("Muat Lebih Banyak")'
            btn = page.query_selector(btn_selector)
            
            if not btn:
                page.mouse.wheel(0, 500)
                time.sleep(1.0)
                btn = page.query_selector(btn_selector)

            if btn and btn.is_visible():
                print("Menemukan tombol 'Muat Lebih Banyak'. Melakukan klik...")
                try:
                    btn.scroll_into_view_if_needed()
                    time.sleep(1.0)
                    btn.click()
                    
                    delay = random.uniform(3.0, 7.0)
                    print(f"Klik berhasil. Menunggu {delay:.2f} detik sebelum melanjutkan...")
                    time.sleep(delay)
                except Exception as e:
                    print(f"Gagal mengklik tombol 'Muat Lebih Banyak': {e}. Berhenti.")
                    break
            else:
                print("Tombol 'Muat Lebih Banyak' tidak ditemukan atau sudah tidak aktif. Pemuatan selesai.")
                break

        context.close()

    return results


def save_data(data: list[dict]):
    """Simpan hasil scraping ke file JSON."""
    os.makedirs("Tokopedia", exist_ok=True)
    filename = f"Tokopedia/scrape_result_{datetime.now().strftime('%Y%m%d_%H%M')}.json"
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\nSelesai. {len(data)} produk disimpan ke {filename}")


def run_scheduler_loop():
    """Menjalankan loop scheduler harian."""
    print(f"\n=================== MODE SCHEDULER AKTIF ===================")
    print(f"Scraper akan otomatis berjalan setiap hari pada pukul: {SCHEDULE_TIME}")
    print(f"Gunakan Ctrl+C untuk menghentikan scheduler.")
    print("============================================================\n")
    
    last_run_date = None
    
    while True:
        now = datetime.now()
        current_time = now.strftime("%H:%M")
        current_date = now.strftime("%Y-%m-%d")
        
        # Jika waktu cocok dan hari ini belum berjalan
        if current_time == SCHEDULE_TIME and current_date != last_run_date:
            print(f"\n[{now.strftime('%Y-%m-%d %H:%M:%S')}] Waktu terjadwal ({SCHEDULE_TIME}) tercapai!")
            print("Memulai proses scraping otomatis...")
            try:
                data = scrape_tokopedia(SEARCH_URL, MAX_PAGES, run_headless=HEADLESS)
                save_data(data)
                last_run_date = current_date
            except Exception as e:
                print(f"Error saat menjalankan scraping otomatis: {e}")
            print(f"\nPencarian selesai. Menunggu jadwal harian berikutnya ({SCHEDULE_TIME})...")
            
        time.sleep(30)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tokopedia Scraper dengan Akun & Scheduler")
    parser.add_argument("--login", action="store_true", help="Buka browser headed untuk login ke akun Tokopedia")
    parser.add_argument("--now", action="store_true", help="Jalankan scraper sekali saat ini juga (untuk debug/refres cepat)")
    parser.add_argument("--schedule", action="store_true", help="Jalankan scraper dalam loop penjadwalan harian")
    
    args = parser.parse_args()
    
    # Jika tidak ada parameter yang diberikan, tampilkan menu atau panduan
    if len(sys.argv) == 1:
        print("\nSilakan pilih mode jalankan:")
        print("  python tokopedia_scheduler.py --login      (Membuka browser untuk login pertama kali)")
        print("  python tokopedia_scheduler.py --now        (Scrape sekali saat ini juga untuk debug)")
        print("  python tokopedia_scheduler.py --schedule   (Jalankan loop scheduler terjadwal)")
        sys.exit(0)
        
    if args.login:
        manual_login()
    elif args.now:
        print("\nMemulai scraping instan saat ini...")
        data = scrape_tokopedia(SEARCH_URL, MAX_PAGES, run_headless=HEADLESS)
        save_data(data)
    elif args.schedule:
        run_scheduler_loop()
