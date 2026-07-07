import { requireUser } from "@/lib/auth";
import { listProducts } from "@/lib/products/store";
import ProductsClient from "./ProductsClient";

export default async function ProductsPage() {
  await requireUser();
  // Load all products once; the client splits them by type into the
  // Products / Equipment sections and filters by sport in-browser.
  const products = await listProducts({ includeArchived: false });
  return <ProductsClient initialProducts={products} />;
}
