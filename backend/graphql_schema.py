import strawberry
from typing import Optional, List
from datetime import datetime
from sqlalchemy.orm import Session
from database import SessionLocal
from postgres_client import PostgresClient

@strawberry.type
class Product:
    id: int
    url: Optional[str]
    timestamp: str
    product_name: Optional[str]
    original_price: Optional[str]
    original_price_cleaned: Optional[int]
    discount_price: Optional[str]
    discount_price_cleaned: Optional[int]
    discount_percentage: Optional[str]
    rating: Optional[str]
    rating_cleaned: Optional[float]
    sold_count: Optional[str]
    sold_count_cleaned: Optional[int]
    store_name: Optional[str]
    store_location: Optional[str]
    store_type: Optional[str]
    source: Optional[str]
    page: Optional[int]
    scraped_at: str

@strawberry.type
class ProductsResponse:
    products: List[Product]
    total: int
    status: str

@strawberry.type
class Query:
    @strawberry.field
    def get_products(
        self,
        limit: int = 20,
        offset: int = 0,
        source: Optional[str] = None,
        search: Optional[str] = None,
        sort_by: str = "scraped_at",
        sort_order: str = "desc"
    ) -> ProductsResponse:
        db = SessionLocal()
        try:
            from models import PostgresConfig
            config = db.query(PostgresConfig).filter(PostgresConfig.id == 1).first()
            if not config or config.status != "connected":
                return ProductsResponse(
                    products=[],
                    total=0,
                    status="PostgreSQL is not configured or not connected."
                )
                
            pg_client = PostgresClient(config.host, config.port, config.database, config.user, config.password)
            results, total = pg_client.get_products(
                limit=limit,
                offset=offset,
                source=source,
                search=search,
                sort_by=sort_by,
                sort_order=sort_order
            )
            
            product_objects = []
            for r in results:
                ts_str = ""
                if isinstance(r.get("timestamp"), datetime):
                    ts_str = r.get("timestamp").isoformat()
                elif r.get("timestamp"):
                    ts_str = str(r.get("timestamp"))
                    
                sa_str = ""
                if isinstance(r.get("scraped_at"), datetime):
                    sa_str = r.get("scraped_at").isoformat()
                elif r.get("scraped_at"):
                    sa_str = str(r.get("scraped_at"))
                
                product_objects.append(
                    Product(
                        id=r.get("id"),
                        url=r.get("url"),
                        timestamp=ts_str,
                        product_name=r.get("product_name"),
                        original_price=r.get("original_price"),
                        original_price_cleaned=r.get("original_price_cleaned"),
                        discount_price=r.get("discount_price"),
                        discount_price_cleaned=r.get("discount_price_cleaned"),
                        discount_percentage=r.get("discount_percentage"),
                        rating=r.get("rating"),
                        rating_cleaned=float(r.get("rating_cleaned")) if r.get("rating_cleaned") is not None else None,
                        sold_count=r.get("sold_count"),
                        sold_count_cleaned=r.get("sold_count_cleaned"),
                        store_name=r.get("store_name"),
                        store_location=r.get("store_location"),
                        store_type=r.get("store_type"),
                        source=r.get("source"),
                        page=r.get("page"),
                        scraped_at=sa_str
                    )
                )
            return ProductsResponse(
                products=product_objects,
                total=total,
                status="connected"
            )
        except Exception as e:
            print(f"GraphQL Query Error: {e}")
            return ProductsResponse(
                products=[],
                total=0,
                status=f"Error querying PostgreSQL: {str(e)}"
            )
        finally:
            db.close()

from strawberry.schema.config import StrawberryConfig
schema = strawberry.Schema(query=Query, config=StrawberryConfig(auto_camel_case=False))
