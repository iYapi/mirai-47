"""
Script Tokopedia Scraper dengan Undetected ChromeDriver (Evasion Captcha/Bot Detection) & Scheduler.
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
SEARCH_URL = "https://www.tokopedia.com/search?navsource=home&q=rtx+3050&source=universe&st=product"
MAX_PAGES = 3
USER_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tokopedia_profile_uc")
# --------------------------------------------

PRODUCT_CARD_SELECTOR = "div[data-testid='divSRPContentProducts'] > div > div > div"
NAME_SELECTOR = "span[class*='tnoqZ'], div[class*='SzILj'] span, [data-testid='spnSRPProdName']"

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

def get_tokopedia_page_url(url: str, page_num: int) -> str:
    """Tambahkan atau perbarui parameter query 'page' pada URL Tokopedia (1-indexed)."""
    parsed = urlparse(url)
    query_params = parse_qs(parsed.query)
    query_params["page"] = [str(page_num)]
    new_query = urlencode(query_params, doseq=True)
    new_parts = list(parsed)
    new_parts[4] = new_query
    return urlunparse(new_parts)

def scroll_to_bottom(driver, card_selector: str, name_selector: str, expected_count: int = 40, max_scrolls: int = 15, scroll_delay: float = 1.2):
    """Scroll ke bawah secara perlahan untuk memicu lazy loading produk di Tokopedia menggunakan Selenium."""
    for idx in range(1, max_scrolls + 1):
        names = driver.find_elements(By.CSS_SELECTOR, f"{card_selector} {name_selector}")
        loaded_count = sum(1 for n in names if n.text.strip())
        
        print(f"  [Scroll {idx}/{max_scrolls}] Kartu termuat: {loaded_count}")
        
        if loaded_count >= expected_count:
            break
            
        driver.execute_script("window.scrollBy(0, 800);")
        time.sleep(scroll_delay + random.uniform(-0.2, 0.3))

def manual_login():
    """Membuka browser Chrome asli headed agar user bisa masuk/login ke akun Tokopedia secara manual."""
    print("\n=================== MODE LOGIN MANUAL TOKOPEDIA (UC) ===================")
    print("Membuka browser Google Chrome dengan undetected-chromedriver...")
    print("1. Silakan login ke akun Tokopedia Anda secara manual di jendela browser yang terbuka.")
    print("2. Setelah sukses masuk/login, kembali ke terminal ini.")
    print("3. Tekan [ENTER] di terminal ini untuk menutup browser dan menyimpan sesi Anda.")
    print("========================================================================\n")
    
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
    driver.get("https://www.tokopedia.com")
    
    input("\nTekan [ENTER] di sini setelah Anda selesai login...")
    driver.quit()
    print("\nSesi login Tokopedia berhasil disimpan ke:", abs_profile_path)

def scrape_tokopedia(base_url: str, max_pages: int, run_headless: bool) -> list[dict]:
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
        print(f"\nMembuka halaman pencarian Tokopedia: {base_url}")
        try:
            driver.get(base_url)
        except Exception as e:
            print(f"Gagal memuat halaman utama: {e}")
            return results

        try:
            WebDriverWait(driver, 15).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "div[data-testid='divSRPContentProducts']"))
            )
        except Exception:
            print("Kontainer produk tidak ditemukan. Mengakhiri pencarian.")
            return results

        for loop_idx in range(1, max_pages + 1):
            print(f"\n[Iterasi Halaman {loop_idx}/{max_pages}] Memproses scroll dan scrape...")
            scroll_to_bottom(driver, PRODUCT_CARD_SELECTOR, NAME_SELECTOR)

            # Ambil semua data produk menggunakan execute_script agar jauh lebih cepat & aman
            js_script = """
            const cards = Array.from(document.querySelectorAll("div[data-testid='divSRPContentProducts'] > div > div > div"));
            return cards.map(card => {
                const nameEl = card.querySelector("span[class*='tnoqZ'], div[class*='SzILj'] span, [data-testid='spnSRPProdName']");
                const priceEl = card.querySelector("div[class*='urMOI'], [data-testid='spnSRPProdPrice']");
                const origPriceEl = card.querySelector("div[class*='e48Km'] span, span[class*='hC1B']");
                const discountPctEl = card.querySelector("span[class*='_7UCYd']");
                const ratingEl = card.querySelector("span[class*='_2NfJx']");
                const soldEl = card.querySelector("span[class*='u6Sfj']");
                const badgeEl = card.querySelector("img[alt='shop badge'], img[src*='official_store'], img[src*='goldmerchant'], img[src*='power_merchant']");
                
                // Store/shop selectors
                const shopLinkEl = card.querySelector("a[data-testid='shopLink'], a[href*='/tokopedia.com/']");
                const shopLocEl = card.querySelector("span[data-testid='spnSRPProdTabShopLoc'], span[data-testid='spnSRPProdLoc']");
                
                let storeName = shopLinkEl ? shopLinkEl.textContent.trim() : null;
                let storeLocation = shopLocEl ? shopLocEl.textContent.trim() : null;
                
                if (!storeName || !storeLocation) {
                    const spans = Array.from(card.querySelectorAll("span[class*='flip']"));
                    if (spans.length >= 2) {
                        if (!storeName) storeName = spans[0].textContent.trim();
                        if (!storeLocation) storeLocation = spans[1].textContent.trim();
                    } else if (spans.length === 1) {
                        if (!storeName) storeName = spans[0].textContent.trim();
                    }
                }
                
                if (!storeName) {
                    const storeEl = card.querySelector("span[class*='si3CN']");
                    if (storeEl) storeName = storeEl.textContent.trim();
                }
                
                const linkEl = card.querySelector('a');
                const href = linkEl ? (linkEl.href || linkEl.getAttribute('href')) : null;
                const name = nameEl ? nameEl.textContent.trim() : null;
                
                let badgeUrl = badgeEl ? badgeEl.getAttribute("src") || "" : "";
                
                return {
                    href,
                    name,
                    activePrice: priceEl ? priceEl.textContent.trim() : null,
                    origPrice: origPriceEl ? origPriceEl.textContent.trim() : null,
                    pctText: discountPctEl ? discountPctEl.textContent.trim() : null,
                    rating: ratingEl ? ratingEl.textContent.trim() : null,
                    soldText: soldEl ? soldEl.textContent.trim() : null,
                    storeName,
                    storeLocation,
                    badgeUrl
                };
            });
            """
            
            cards_data = driver.execute_script(js_script)
            new_cards_count = 0
            
            for item in cards_data:
                try:
                    product_url = item.get("href")
                    product_name = item.get("name")
                    if not product_name:
                        continue
                        
                    clean_url_route = None
                    if product_url:
                        clean_url = product_url.split("?")[0]
                        if not clean_url.startswith("http"):
                            clean_url = f"https://www.tokopedia.com{clean_url}"
                        if clean_url in scraped_urls:
                            continue
                        scraped_urls.add(clean_url)
                        clean_url_route = clean_url
                    else:
                        if product_name in scraped_urls:
                            continue
                        scraped_urls.add(product_name)

                    original_price = item.get("origPrice")
                    discount_price = item.get("activePrice")
                    discount_percentage = item.get("pctText")
                    rating = item.get("rating")
                    sold_count = item.get("soldText")
                    store_name = item.get("storeName")
                    store_location = item.get("storeLocation")
                    badge_url = item.get("badgeUrl") or ""
                    
                    if not original_price:
                        original_price = discount_price
                        discount_price = None

                    store_type = "Regular Merchant"
                    if "official_store" in badge_url or "badge_os" in badge_url:
                        store_type = "Official Store"
                    elif "goldmerchant" in badge_url or "power_merchant" in badge_url:
                        store_type = "Power Merchant"

                    results.append({
                        "url": clean_url_route,
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

            print(f"Berhasil memproses {new_cards_count} produk baru pada halaman ini. (Total: {len(results)})")
            
            # If we've reached the last page, we stop
            if loop_idx >= max_pages:
                break
                
            # Scroll down to make "Muat Lebih Banyak" button visible
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(1.5)

            # Try to find and click the "Muat Lebih Banyak" button
            btn_clicked = False
            try:
                btn = WebDriverWait(driver, 6).until(
                    EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Muat Lebih Banyak')] | //button//*[contains(text(), 'Muat Lebih Banyak')]"))
                )
                print("Menemukan tombol 'Muat Lebih Banyak'. Melakukan klik...")
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", btn)
                time.sleep(1.0)
                btn.click()
                
                delay = random.uniform(3.0, 6.0)
                print(f"Klik berhasil. Menunggu {delay:.2f} detik agar produk baru dimuat...")
                time.sleep(delay)
                btn_clicked = True
            except Exception as e:
                print(f"Tombol 'Muat Lebih Banyak' tidak ditemukan atau tidak dapat diklik (mungkin sudah akhir halaman): {e}")

            # Fallback scroll wheel if button not found or click failed
            if not btn_clicked:
                driver.execute_script("window.scrollBy(0, 600);")
                time.sleep(1.5)
                
    except Exception as e:
        print(f"Error scraping Tokopedia: {e}")
    finally:
        driver.quit()
        
    return results

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tokopedia Scraper CLI")
    parser.add_argument("--url", type=str, default=SEARCH_URL, help="Target search URL")
    parser.add_argument("--pages", type=int, default=MAX_PAGES, help="Max pages to scrape")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    parser.add_argument("--output", type=str, default="tokopedia_result.json", help="File output JSON")
    parser.add_argument("--login", action="store_true", help="Run headed login session only")
    args = parser.parse_args()

    if args.login:
        manual_login()
    else:
        print(f"Starting Tokopedia Scraper...")
        print(f"Target URL: {args.url}")
        print(f"Pages: {args.pages}")
        print(f"Headless Mode: {args.headless}")
        print(f"Output: {args.output}")

        try:
            results = scrape_tokopedia(args.url, args.pages, args.headless)
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
            print(f"Scraping successfully finished. {len(results)} items saved.")
        except Exception as e:
            print(f"Execution Error: {e}", file=sys.stderr)
            sys.exit(1)
