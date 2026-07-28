import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime

class PostgresClient:
    def __init__(self, host, port, database, user, password):
        self.host = host
        self.port = int(port)
        self.database = database
        self.user = user
        self.password = password

    def _get_connection(self):
        conn = psycopg2.connect(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
            connect_timeout=5
        )
        conn.set_client_encoding('UTF8')
        return conn

    def test_connection(self):
        """Test if the connection can be established."""
        try:
            conn = self._get_connection()
            conn.close()
            return True, "Connection successful"
        except Exception as e:
            return False, str(e)

    def init_db(self):
        """Create the scraped_products table if it doesn't exist."""
        query = """
        CREATE TABLE IF NOT EXISTS scraped_products (
            id SERIAL PRIMARY KEY,
            product_name TEXT NOT NULL,
            original_price TEXT,
            original_price_cleaned BIGINT,
            discount_price TEXT,
            discount_price_cleaned BIGINT,
            discount_percentage TEXT,
            rating TEXT,
            rating_cleaned NUMERIC(3,2),
            sold_count TEXT,
            sold_count_cleaned INTEGER,
            store_name TEXT,
            store_location TEXT,
            store_type TEXT,
            source TEXT NOT NULL,
            page INTEGER,
            scraped_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_products_source ON scraped_products(source);
        CREATE INDEX IF NOT EXISTS idx_products_scraped_at ON scraped_products(scraped_at);
        """
        try:
            conn = self._get_connection()
            with conn.cursor() as cur:
                cur.execute(query)
                conn.commit()
            conn.close()
            return True, "Table initialized successfully"
        except Exception as e:
            return False, str(e)

    def insert_products(self, products: list[dict]) -> int:
        """Insert scraped products into PostgreSQL database. Returns count of inserted products."""
        if not products:
            return 0
            
        success, err_msg = self.init_db()
        if not success:
            raise Exception(f"Failed to initialize PostgreSQL table: {err_msg}")

        query = """
        INSERT INTO scraped_products (
            product_name, original_price, original_price_cleaned,
            discount_price, discount_price_cleaned, discount_percentage,
            rating, rating_cleaned, sold_count, sold_count_cleaned,
            store_name, store_location, store_type, source, page, scraped_at
        ) VALUES (
            %(product_name)s, %(original_price)s, %(original_price_cleaned)s,
            %(discount_price)s, %(discount_price_cleaned)s, %(discount_percentage)s,
            %(rating)s, %(rating_cleaned)s, %(sold_count)s, %(sold_count_cleaned)s,
            %(store_name)s, %(store_location)s, %(store_type)s, %(source)s, %(page)s, %(scraped_at)s
        )
        """
        
        inserted_count = 0
        try:
            conn = self._get_connection()
            with conn.cursor() as cur:
                for product in products:
                    scraped_at = product.get("scraped_at")
                    if isinstance(scraped_at, str):
                        try:
                            scraped_at = datetime.fromisoformat(scraped_at.replace("Z", "+00:00"))
                        except ValueError:
                            scraped_at = datetime.utcnow()
                    
                    product_data = {
                        "product_name": product.get("product_name"),
                        "original_price": product.get("original_price"),
                        "original_price_cleaned": product.get("original_price_cleaned"),
                        "discount_price": product.get("discount_price"),
                        "discount_price_cleaned": product.get("discount_price_cleaned"),
                        "discount_percentage": product.get("discount_percentage"),
                        "rating": product.get("rating"),
                        "rating_cleaned": product.get("rating_cleaned"),
                        "sold_count": product.get("sold_count"),
                        "sold_count_cleaned": product.get("sold_count_cleaned"),
                        "store_name": product.get("store_name"),
                        "store_location": product.get("store_location"),
                        "store_type": product.get("store_type"),
                        "source": product.get("source", "unknown"),
                        "page": product.get("page", 1),
                        "scraped_at": scraped_at
                    }
                    
                    cur.execute(query, product_data)
                    inserted_count += 1
                conn.commit()
            conn.close()
        except Exception as e:
            print(f"Error inserting products to Postgres: {e}")
            raise e
            
        return inserted_count

    def get_products(self, limit=100, offset=0, source=None, search=None, sort_by="scraped_at", sort_order="desc"):
        """Fetch products from PostgreSQL for data viewing in dashboard."""
        query = "SELECT * FROM scraped_products WHERE 1=1"
        params = {}
        
        if source:
            query += " AND source = %(source)s"
            params["source"] = source
            
        if search:
            query += " AND product_name ILIKE %(search)s"
            params["search"] = f"%{search}%"
            
        # Sorting validation
        allowed_columns = {
            "scraped_at": "scraped_at",
            "price": "original_price_cleaned",
            "rating": "rating_cleaned",
            "sold": "sold_count_cleaned"
        }
        sort_column = allowed_columns.get(sort_by, "scraped_at")
        sort_dir = "DESC" if sort_order.lower() == "desc" else "ASC"
        
        query += f" ORDER BY {sort_column} {sort_dir} NULLS LAST LIMIT %(limit)s OFFSET %(offset)s"
        params["limit"] = limit
        params["offset"] = offset
        
        count_query = "SELECT COUNT(*) FROM scraped_products WHERE 1=1"
        count_params = {}
        if source:
            count_query += " AND source = %(source)s"
            count_params["source"] = source
        if search:
            count_query += " AND product_name ILIKE %(search)s"
            count_params["search"] = f"%{search}%"

        results = []
        total = 0
        
        try:
            conn = self._get_connection()
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(query, params)
                results = list(cur.fetchall())
                
                # Fetch count
                cur.execute(count_query, count_params)
                total = cur.fetchone()['count']
            conn.close()
        except Exception as e:
            print(f"Error fetching products from Postgres: {e}")
            
        return results, total
