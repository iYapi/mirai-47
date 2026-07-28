"""
Script Shopee Scrapper dengan Undetected ChromeDriver (Evasion Captcha/Bot Detection) & Scheduler.
Adaptasi untuk scraping dashboard manager.
"""

import os
import sys
import json
import time
import random
import argparse
import subprocess
import re
import platform
from datetime import datetime
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def get_chrome_major_version() -> int | None:
    """Deteksi versi major dari Google Chrome yang terpasang di macOS atau Linux."""
    try:
        if platform.system() == "Darwin":
            output = subprocess.check_output([
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--version"
            ]).decode("utf-8")
        else:  # Linux / Zorin OS
            try:
                output = subprocess.check_output(["google-chrome", "--version"]).decode("utf-8")
            except Exception:
                output = subprocess.check_output(["google-chrome-stable", "--version"]).decode("utf-8")
        
        match = re.search(r"Google Chrome (\d+)", output)
        if match:
            version = int(match.group(1))
            print(f"Terdeteksi versi Google Chrome utama: {version}")
            return version
    except Exception as e:
        print(f"Gagal mendeteksi versi Google Chrome secara otomatis: {e}")
    return None

def clear_chrome_lock(profile_path: str):
    """Menghapus file lock Chromium jika ada untuk mencegah error 'chrome not reachable'."""
    lock_file = os.path.join(profile_path, "SingletonLock")
    if os.path.exists(lock_file) or os.path.islink(lock_file):
        try:
            os.unlink(lock_file)
            print("Berhasil menghapus file SingletonLock yang menggantung.")
        except Exception as e:
            print(f"Gagal menghapus SingletonLock: {e}")

# ------------------ CONFIG ------------------
SEARCH_URL = "https://shopee.co.id/search?keyword=rtx%203050"
MAX_PAGES = 3
USER_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shopee_profile_uc")
# --------------------------------------------

PRODUCT_CARD_SELECTOR = 'div[aria-label="Product card"]'
NAME_SELECTOR = "div.line-clamp-2, div[class*='line-clamp-2']"

def clean_price(price_raw: str | None) -> int | None:
    """Ubah 'Rp1.250.000' atau '1.250.000' jadi 1250000 (integer)."""
    if not price_raw:
        return None
    first_part = price_raw.split("-")[0]
    digits = "".join(ch for ch in first_part if ch.isdigit())
    return int(digits) if digits else None

def clean_rating(rating_raw: str | None) -> float | None:
    """Ubah rating mentah menjadi float."""
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
    s = s.replace("terjual", "").replace("+", "").replace("sold", "").strip()
    
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

def get_shopee_page_url(url: str, page_num: int) -> str:
    """Tambahkan atau perbarui parameter query 'page' pada URL Shopee (0-indexed)."""
    parsed = urlparse(url)
    query_params = parse_qs(parsed.query)
    query_params["page"] = [str(page_num)]
    new_query = urlencode(query_params, doseq=True)
    new_parts = list(parsed)
    new_parts[4] = new_query
    return urlunparse(new_parts)

def scroll_to_bottom(driver, card_selector: str, name_selector: str, expected_count: int = 50, max_scrolls: int = 15, scroll_delay: float = 1.2):
    """Scroll ke bawah secara perlahan untuk memicu lazy loading produk di Shopee menggunakan Selenium."""
    for idx in range(1, max_scrolls + 1):
        names = driver.find_elements(By.CSS_SELECTOR, f"{card_selector} {name_selector}")
        loaded_count = sum(1 for n in names if n.text.strip())
        
        print(f"  [Scroll {idx}/{max_scrolls}] Kartu termuat: {loaded_count}")
        
        if loaded_count >= expected_count:
            break
            
        driver.execute_script("window.scrollBy(0, 800);")
        time.sleep(scroll_delay + random.uniform(-0.2, 0.3))

def manual_login():
    """Membuka browser Chrome asli headed agar user bisa login manual."""
    print("\n=================== MODE LOGIN MANUAL SHOPEE (UC) ===================")
    print("Membuka browser Google Chrome dengan undetected-chromedriver...")
    print("1. Silakan login ke akun Shopee Anda secara manual di jendela browser yang terbuka.")
    print("2. Selesaikan verifikasi OTP / captcha slider jika muncul.")
    print("3. Setelah login sukses ke halaman utama, kembali ke terminal ini.")
    print("4. Tekan [ENTER] di terminal ini untuk menutup browser dan menyimpan sesi Anda.")
    print("=====================================================================\n")
    
    abs_profile_path = os.path.abspath(USER_DATA_DIR)
    os.makedirs(abs_profile_path, exist_ok=True)
    clear_chrome_lock(abs_profile_path)
    
    options = uc.ChromeOptions()
    options.add_argument("--disable-http2")
    
    chrome_version = get_chrome_major_version()
    if chrome_version:
        driver = uc.Chrome(options=options, user_data_dir=abs_profile_path, version_main=chrome_version)
    else:
        driver = uc.Chrome(options=options, user_data_dir=abs_profile_path)
    driver.get("https://shopee.co.id")
    
    time.sleep(3)
    try:
        lang_btn = driver.find_element(By.XPATH, '//button[text()="Bahasa Indonesia"]')
        if lang_btn:
            lang_btn.click()
    except Exception:
        pass
        
    input("\nTekan [ENTER] di sini setelah Anda selesai login...")
    driver.quit()
    print("\nSesi login Shopee berhasil disimpan ke:", abs_profile_path)

def scrape_shopee(base_url: str, max_pages: int, run_headless: bool) -> list[dict]:
    results = []
    scraped_urls = set()
    
    abs_profile_path = os.path.abspath(USER_DATA_DIR)
    print(f"Menggunakan profil login dari: {abs_profile_path}")
    clear_chrome_lock(abs_profile_path)
    
    options = uc.ChromeOptions()
    options.add_argument("--disable-http2")
    if run_headless:
        options.add_argument("--headless")
        
    chrome_version = get_chrome_major_version()
    if chrome_version:
        driver = uc.Chrome(options=options, user_data_dir=abs_profile_path, version_main=chrome_version)
    else:
        driver = uc.Chrome(options=options, user_data_dir=abs_profile_path)
    
    try:
        for page_idx in range(max_pages):
            url = get_shopee_page_url(base_url, page_idx)
            print(f"\n[Iterasi {page_idx + 1}/{max_pages}] Membuka halaman: {url}")
            
            try:
                driver.get(url)
            except Exception as e:
                print(f"Gagal memuat halaman: {e}")
                break

            time.sleep(3)
            try:
                lang_btn = driver.find_element(By.XPATH, '//button[text()="Bahasa Indonesia"]')
                if lang_btn:
                    print("Memilih Bahasa Indonesia...")
                    lang_btn.click()
                    time.sleep(2.0)
            except Exception:
                pass

            try:
                WebDriverWait(driver, 15).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR))
                )
            except Exception:
                print("Kontainer produk tidak terdeteksi pada halaman ini. Mungkin memerlukan login akun.")
                error_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Shopee")
                os.makedirs(error_dir, exist_ok=True)
                driver.save_screenshot(os.path.join(error_dir, "error_load.png"))
                print(f"Screenshot debug disimpan ke {error_dir}/error_load.png")
                break

            scroll_to_bottom(driver, PRODUCT_CARD_SELECTOR, NAME_SELECTOR, expected_count=100, max_scrolls=5)

            js_script = """
            return Array.from(document.querySelectorAll('div[aria-label="Product card"]')).map(card => {
                const a = card.querySelector('a');
                const href = a ? a.getAttribute('href') : null;
                
                const nameEl = card.querySelector('div.line-clamp-2, div[class*="line-clamp-2"]');
                const name = nameEl ? nameEl.textContent.trim() : null;
                
                const priceActiveEl = card.querySelector('div[class*="text-shopee-primary"]:not([class*="bg-shopee"])');
                const priceOrigEl = card.querySelector('div[class*="line-through"]');
                const pctEl = card.querySelector('div[class*="bg-shopee-pink"]');
                
                const activePrice = priceActiveEl ? priceActiveEl.textContent.trim() : null;
                const origPrice = priceOrigEl ? priceOrigEl.textContent.trim() : null;
                const pctText = pctEl ? pctEl.textContent.trim() : null;
                
                let rating = null;
                const els = Array.from(card.querySelectorAll('div, span'));
                for (const el of els) {
                    const txt = el.textContent.trim();
                    if (/^[1-5]\\.[0-9]$/.test(txt)) {
                        rating = txt;
                        break;
                    }
                }
                
                const soldEl = card.querySelector('div[class*="text-shopee-black87"]');
                const soldText = soldEl ? soldEl.textContent.trim() : null;
                
                let location = null;
                const divs = Array.from(card.querySelectorAll('div'));
                for (let i = divs.length - 1; i >= 0; i--) {
                    const txt = divs[i].textContent.trim();
                    if (txt && txt.length < 25) {
                        if (!/rp|%|terjual|sold|hari|day|min|sec|jam/i.test(txt)) {
                            if (!/\\d/.test(txt)) {
                                location = txt;
                                break;
                            }
                        }
                    }
                }
                
                let storeType = "Regular Merchant";
                const badgeImg = card.querySelector('img[alt="flag-label"]');
                if (badgeImg) {
                    const src = badgeImg.getAttribute('src') || "";
                    if (src.includes('7r98z')) {
                        storeType = "Shopee Mall";
                    } else if (src.includes('7r98r')) {
                        storeType = "Star Seller";
                    }
                }
                
                return {
                    href,
                    name,
                    activePrice,
                    origPrice,
                    pctText,
                    rating,
                    soldText,
                    location,
                    storeType
                };
            });
            """
            
            try:
                scraped_data = driver.execute_script(js_script)
            except Exception as e:
                print(f"Gagal mengeksekusi script ekstraksi halaman: {e}")
                scraped_data = []

            new_cards_count = 0
            for item in scraped_data:
                try:
                    product_url = item["href"]
                    product_name = item["name"]
                    if not product_name:
                        continue
                        
                    if product_url:
                        clean_url = product_url.split("?")[0]
                        if clean_url in scraped_urls:
                            continue
                        scraped_urls.add(clean_url)
                    else:
                        if product_name in scraped_urls:
                            continue
                        scraped_urls.add(product_name)

                    active_price_raw = item["activePrice"]
                    orig_price_raw = item["origPrice"]
                    discount_percentage = item["pctText"]
                    
                    if orig_price_raw:
                        original_price = orig_price_raw
                        discount_price = active_price_raw
                    else:
                        original_price = active_price_raw
                        discount_price = None

                    store_location = item["location"]
                    rating = item["rating"]
                    sold_text = item["soldText"]
                    store_type = item["storeType"] or "Regular Merchant"

                    results.append({
                        "product_name": product_name,
                        "original_price": original_price,
                        "original_price_cleaned": clean_price(original_price),
                        "discount_price": discount_price,
                        "discount_price_cleaned": clean_price(discount_price),
                        "discount_percentage": discount_percentage,
                        "rating": rating,
                        "rating_cleaned": clean_rating(rating),
                        "sold_count": sold_text,
                        "sold_count_cleaned": clean_sold_count(sold_text),
                        "store_name": None,
                        "store_location": store_location,
                        "store_type": store_type,
                        "source": "shopee",
                        "page": page_idx + 1,
                        "scraped_at": datetime.now().isoformat(),
                    })
                    new_cards_count += 1
                except Exception:
                    continue

            print(f"Berhasil memproses {new_cards_count} produk baru pada halaman ini. (Total: {len(results)})")

            if page_idx < max_pages - 1:
                delay = random.uniform(4.0, 8.0)
                print(f"Menunggu {delay:.2f} detik sebelum membuka halaman berikutnya...")
                time.sleep(delay)

    finally:
        driver.quit()

    return results

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Shopee Scraper CLI")
    parser.add_argument("--url", type=str, default=SEARCH_URL, help="URL pencarian Shopee")
    parser.add_argument("--pages", type=int, default=MAX_PAGES, help="Jumlah halaman pencarian Shopee")
    parser.add_argument("--headless", action="store_true", help="Jalankan headless")
    parser.add_argument("--output", type=str, default="shopee_result.json", help="File output JSON")
    parser.add_argument("--login", action="store_true", help="Jalankan manual login browser")
    
    args = parser.parse_args()
    
    if args.login:
        manual_login()
    else:
        print(f"Starting Shopee Scraper...")
        print(f"Target URL: {args.url}")
        print(f"Pages: {args.pages}")
        print(f"Headless Mode: {args.headless}")
        print(f"Output: {args.output}")
        
        try:
            data = scrape_shopee(args.url, args.pages, run_headless=args.headless)
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"Scraping successfully finished. {len(data)} items saved.")
        except Exception as e:
            print(f"Execution Error: {e}", file=sys.stderr)
            sys.exit(1)
