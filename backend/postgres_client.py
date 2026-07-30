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
        """Create the raw_scrapes table if it doesn't exist. Re-creates if old schema detected."""
        check_query = """
        SELECT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name='raw_scrapes' AND column_name='raw_data'
        );
        """
        table_exists_query = """
        SELECT EXISTS (
            SELECT 1 
            FROM information_schema.tables 
            WHERE table_name='raw_scrapes'
        );
        """
        
        try:
            conn = self._get_connection()
            with conn.cursor() as cur:
                # Check if table exists
                cur.execute(table_exists_query)
                table_exists = cur.fetchone()[0]
                
                if table_exists:
                    # Check if it has raw_data column
                    cur.execute(check_query)
                    has_raw_data = cur.fetchone()[0]
                    if not has_raw_data:
                        print("Old raw_scrapes schema detected. Dropping table to recreate with JSONB support...")
                        cur.execute("DROP TABLE IF EXISTS raw_scrapes CASCADE;")
                        conn.commit()
                
                # Now create the new table structure
                create_query = """
                CREATE TABLE IF NOT EXISTS raw_scrapes (
                    id SERIAL PRIMARY KEY,
                    url TEXT,
                    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    raw_data JSONB NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_products_url ON raw_scrapes(url);
                CREATE INDEX IF NOT EXISTS idx_products_timestamp ON raw_scrapes(timestamp);
                CREATE INDEX IF NOT EXISTS idx_products_source ON raw_scrapes ((raw_data->>'source'));
                """
                cur.execute(create_query)
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
        INSERT INTO raw_scrapes (url, timestamp, raw_data)
        VALUES (%(url)s, %(timestamp)s, %(raw_data)s)
        """
        
        import json
        inserted_count = 0
        try:
            conn = self._get_connection()
            with conn.cursor() as cur:
                for product in products:
                    product_url = product.get("url")
                    
                    scraped_at = product.get("scraped_at")
                    if isinstance(scraped_at, str):
                        try:
                            scraped_at = datetime.fromisoformat(scraped_at.replace("Z", "+00:00"))
                        except ValueError:
                            scraped_at = datetime.utcnow()
                    else:
                        scraped_at = datetime.utcnow()
                    
                    # Store everything in raw_data as serialized JSON
                    raw_data_json = json.dumps(product, ensure_ascii=False)
                    
                    product_data = {
                        "url": product_url,
                        "timestamp": scraped_at,
                        "raw_data": raw_data_json
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
        query = """
        SELECT 
            id,
            url,
            timestamp,
            raw_data->>'product_name' AS product_name,
            raw_data->>'original_price' AS original_price,
            (raw_data->>'original_price_cleaned')::bigint AS original_price_cleaned,
            raw_data->>'discount_price' AS discount_price,
            (raw_data->>'discount_price_cleaned')::bigint AS discount_price_cleaned,
            raw_data->>'discount_percentage' AS discount_percentage,
            raw_data->>'rating' AS rating,
            (raw_data->>'rating_cleaned')::numeric(3,2) AS rating_cleaned,
            raw_data->>'sold_count' AS sold_count,
            (raw_data->>'sold_count_cleaned')::integer AS sold_count_cleaned,
            raw_data->>'store_name' AS store_name,
            raw_data->>'store_location' AS store_location,
            raw_data->>'store_type' AS store_type,
            raw_data->>'source' AS source,
            (raw_data->>'page')::integer AS page,
            raw_data->>'query_keyword' AS query_keyword,
            raw_data->>'job_name' AS job_name,
            timestamp AS scraped_at
        FROM raw_scrapes 
        WHERE 1=1
        """
        params = {}
        
        if source:
            query += " AND raw_data->>'source' = %(source)s"
            params["source"] = source
            
        if search:
            query += " AND raw_data->>'product_name' ILIKE %(search)s"
            params["search"] = f"%{search}%"
            
        # Sorting validation
        allowed_columns = {
            "scraped_at": "timestamp",
            "price": "(raw_data->>'original_price_cleaned')::bigint",
            "rating": "(raw_data->>'rating_cleaned')::numeric(3,2)",
            "sold": "(raw_data->>'sold_count_cleaned')::integer"
        }
        sort_column = allowed_columns.get(sort_by, "timestamp")
        sort_dir = "DESC" if sort_order.lower() == "desc" else "ASC"
        
        query += f" ORDER BY {sort_column} {sort_dir} NULLS LAST LIMIT %(limit)s OFFSET %(offset)s"
        params["limit"] = limit
        params["offset"] = offset
        
        count_query = "SELECT COUNT(*) FROM raw_scrapes WHERE 1=1"
        count_params = {}
        if source:
            count_query += " AND raw_data->>'source' = %(source)s"
            count_params["source"] = source
        if search:
            count_query += " AND raw_data->>'product_name' ILIKE %(search)s"
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

    def get_price_history(self, url=None, product_name=None):
        """Fetch historical price list for a single product matching URL or name."""
        if not url and not product_name:
            return []
            
        query = """
        SELECT 
            timestamp AS scraped_at,
            raw_data->>'original_price' AS original_price,
            (raw_data->>'original_price_cleaned')::bigint AS original_price_cleaned,
            raw_data->>'discount_price' AS discount_price,
            (raw_data->>'discount_price_cleaned')::bigint AS discount_price_cleaned,
            raw_data->>'product_name' AS product_name
        FROM raw_scrapes
        WHERE 1=1
        """
        params = {}
        if url:
            query += " AND url = %(url)s"
            params["url"] = url
        elif product_name:
            query += " AND raw_data->>'product_name' = %(product_name)s"
            params["product_name"] = product_name
            
        query += " ORDER BY timestamp ASC"
        
        results = []
        try:
            conn = self._get_connection()
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(query, params)
                results = list(cur.fetchall())
            conn.close()
        except Exception as e:
            print(f"Error fetching product price history: {e}")
            
        return results
