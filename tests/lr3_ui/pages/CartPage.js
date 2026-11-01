class CartPage {
  constructor(page) {
    this.page = page;
    this.promoInput = page.getByTestId('promo-input');
    this.applyPromoButton = page.getByTestId('apply-promo');
    this.message = page.getByTestId('message');
    this.checkoutButton = page.getByTestId('checkout');
    this.orderModal = page.getByTestId('order-modal');
    this.orderId = page.getByTestId('order-id');
    this.totals = page.getByTestId('totals');
    this.cartItems = page.getByTestId('cart-items');
  }

  async open() {
    await this.page.goto('/');
    await this.page.getByTestId('product-p1').waitFor();
  }

  product(id) {
    return this.page.getByTestId(`product-${id}`);
  }

  addButton(id) {
    return this.page.getByTestId(`add-${id}`);
  }

  async addProduct(id) {
    await this.addButton(id).click();
    await this.page.getByTestId(`cart-item-${id}`).waitFor();
  }

  qtyInput(id) {
    return this.page.getByTestId(`qty-${id}`);
  }

  async setQuantity(id, quantity) {
    const input = this.qtyInput(id);
    await input.fill(String(quantity));
    await input.dispatchEvent('change');
  }

  async applyPromo(code) {
    await this.promoInput.fill(code);
    await this.applyPromoButton.click();
  }

  async checkout() {
    await this.checkoutButton.click();
  }
}

module.exports = { CartPage };
