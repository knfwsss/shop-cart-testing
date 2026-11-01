/** Каталог товаров и остатки на складе */
const PRODUCTS = [
  { id: 'p1', name: 'Наушники Bluetooth', price: 2990, stock: 15 },
  { id: 'p2', name: 'Клавиатура механическая', price: 5490, stock: 8 },
  { id: 'p3', name: 'USB-C кабель 2м', price: 590, stock: 0 },
  { id: 'p4', name: 'Веб-камера HD', price: 3490, stock: 12 },
];

function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

function listProducts() {
  return PRODUCTS.map(({ id, name, price, stock }) => ({
    id,
    name,
    price,
    stock,
    inStock: stock > 0,
  }));
}

module.exports = { PRODUCTS, getProduct, listProducts };