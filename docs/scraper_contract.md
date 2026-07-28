# Scraper Script Rules & CLI Contract

To upload and execute custom python scrapers dynamically through the dashboard, scripts must follow a strict command-line argument structure and output file format.

---

## 1. CLI Arguments Requirement
Your script must use python's standard `argparse` library (or equivalent) to accept the following parameters passed by the scheduler backend:

| Argument | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `--url` | `str` | *None* | The target search URL (e.g. Shopee keyword URL or Tokopedia search query URL). |
| `--pages` | `int` | `3` | Maximum number of pages the scraper should scan. |
| `--output` | `str` | *None* | Absolute path to the output JSON file. The script must write its findings here. |
| `--headless` | *Flag* | *False* | If present, the scraper browser must run in background headless mode. If absent, it should run headed. |
| `--login` | *Flag* | *False* | If present, the scraper should launch headed to let the user log in manually, save cookies/session, then exit immediately. |

### Example Argparse Setup
```python
import argparse

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Custom Scraper CLI")
    parser.add_argument("--url", type=str, required=True)
    parser.add_argument("--pages", type=int, default=3)
    parser.add_argument("--output", type=str)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--login", action="store_true")
    
    args = parser.parse_args()
    
    if args.login:
        run_login_mode()
    else:
        scrape(args.url, args.pages, args.output, args.headless)
```

---

## 2. Output File Format Contract
On successful completion, your scraper **must** write a JSON array containing scraped product objects to the path provided in `--output`. The structure of each product object should map to this format:

```json
[
  {
    "product_name": "Required (string) - Full name of the product",
    "original_price": "Optional (string) - E.g. 'Rp1.250.000'",
    "original_price_cleaned": "Optional (integer) - Price digits parsed to integer, e.g. 1250000",
    "discount_price": "Optional (string) - Discounted active price, e.g. 'Rp1.000.000' or null",
    "discount_price_cleaned": "Optional (integer) - Discounted price digits parsed to integer or null",
    "discount_percentage": "Optional (string) - E.g. '20%' or null",
    "rating": "Optional (string) - Rating score e.g. '4.8' or null",
    "rating_cleaned": "Optional (float) - Rating score converted to float, e.g. 4.8 or null",
    "sold_count": "Optional (string) - Sold summary string e.g. '100+ terjual' or null",
    "sold_count_cleaned": "Optional (integer) - Clean count of sold items, e.g. 100 or null",
    "store_name": "Optional (string) - Name of the merchant store or null",
    "store_location": "Optional (string) - Location location (city) or null",
    "store_type": "Optional (string) - Store badge classification, e.g. 'Star Seller', 'Official Store'",
    "source": "Required (string) - Scraper source label, e.g. 'shopee', 'tokopedia', or custom key",
    "page": "Required (integer) - Page index where this item was found",
    "scraped_at": "Required (string) - ISO 8601 string format: YYYY-MM-DDTHH:MM:SS"
  }
]
```

---

## 3. Persistent Profile Directories
To maintain login cookie sessions:
- Always save profile data to absolute paths relative to your script's folder.
- Example: `os.path.join(os.path.dirname(os.path.abspath(__file__)), "profile_directory")`.
- Clean up dangling Singleton Locks inside Chromium profiles on script startup to prevent browser blockages:
```python
def clear_lock(profile_path):
    lock_file = os.path.join(profile_path, "SingletonLock")
    if os.path.exists(lock_file) or os.path.islink(lock_file):
        os.unlink(lock_file)
```
