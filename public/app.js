const SESSION_ID = (() => {
  const saved = localStorage.getItem('cartSessionId');
  if (saved) return saved;
  const id = crypto.randomUUID();
  localStorage.setItem('cartSessionId', id);
  return id;
})();

const api = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': SESSION_ID,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

const formatPrice = (n) => n.toLocaleString('ru-RU');

const showMessage = (text, type = 'error') => {
  const el = document.getElementById('message');
  el.className = `message ${type}`;
  el.textContent = text;
  if (type === 'success') {
    setTimeout(() => { el.textContent = ''; el.className = 'message'; }, 4000);
  }
};

const renderProducts = (products) => {
  const container = document.getElementById('products');
  container.innerHTML = products.map((p) => `
    <div class="product-card" data-id="${p.id}" data-testid="product-${p.id}">
      <div class="product-info">
        <h3>${p.name}</h3>
        <div class="price">${formatPrice(p.price)} ₽</div>
        <div class="stock ${p.inStock ? '' : 'out'}">
          ${p.inStock ? `В наличии: ${p.stock} шт.` : 'Нет в наличии'}
        </div>
      </div>
      <button class="btn-primary add-btn" data-testid="add-${p.id}" data-id="${p.id}" ${!p.inStock ? 'disabled' : ''}>
        В корзину
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.add-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api('/api/cart/items', {
          method: 'POST',
          body: JSON.stringify({ productId: btn.dataset.id, quantity: 1 }),
        });
        showMessage('Товар добавлен в корзину', 'success');
        await loadCart();
      } catch (e) {
        showMessage(e.message);
      }
    });
  });
};

const renderCart = (cart) => {
  const itemsEl = document.getElementById('cart-items');
  const checkoutBtn = document.getElementById('checkout-btn');

  if (!cart.items.length) {
    itemsEl.innerHTML = '<div class="empty-cart">Корзина пуста</div>';
    checkoutBtn.disabled = true;
  } else {
    itemsEl.innerHTML = cart.items.map((item) => `
      <div class="cart-item" data-id="${item.productId}" data-testid="cart-item-${item.productId}">
        <div>
          <strong>${item.name}</strong><br>
          <small>${formatPrice(item.unitPrice)} ₽ × ${item.quantity}</small>
        </div>
        <div class="qty-control">
          <button class="qty-minus" data-id="${item.productId}">−</button>
          <input type="number" min="0" value="${item.quantity}" data-id="${item.productId}" data-testid="qty-${item.productId}" class="qty-input">
          <button class="qty-plus" data-id="${item.productId}">+</button>
        </div>
        <div><strong>${formatPrice(item.unitPrice * item.quantity)} ₽</strong></div>
      </div>
    `).join('');
    checkoutBtn.disabled = false;

    const updateQty = async (productId, quantity) => {
      try {
        await api(`/api/cart/items/${productId}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity }),
        });
        await loadCart();
      } catch (e) {
        showMessage(e.message);
        await loadCart();
      }
    };

    itemsEl.querySelectorAll('.qty-minus').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = itemsEl.querySelector(`.qty-input[data-id="${btn.dataset.id}"]`);
        updateQty(btn.dataset.id, Math.max(0, Number(input.value) - 1));
      });
    });

    itemsEl.querySelectorAll('.qty-plus').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = itemsEl.querySelector(`.qty-input[data-id="${btn.dataset.id}"]`);
        updateQty(btn.dataset.id, Number(input.value) + 1);
      });
    });

    itemsEl.querySelectorAll('.qty-input').forEach((input) => {
      input.addEventListener('change', () => {
        updateQty(input.dataset.id, Number(input.value));
      });
    });
  }

  const totalsEl = document.getElementById('totals');
  let html = `
    <div class="row"><span>Промежуточный итог</span><span>${formatPrice(cart.subtotal)} ₽</span></div>
  `;
  if (cart.promoApplied) {
    html += `
      <div class="row"><span>Скидка (${cart.discountPercent}%)</span><span>−${formatPrice(cart.discount)} ₽</span></div>
      <div class="row"><span>Промокод</span><span>${cart.promoCode}</span></div>
    `;
  }
  html += `<div class="row total"><span>Итого</span><span>${formatPrice(cart.total)} ₽</span></div>`;
  totalsEl.innerHTML = html;
};

const loadProducts = async () => {
  const products = await api('/api/products');
  renderProducts(products);
};

const loadCart = async () => {
  const cart = await api('/api/cart');
  renderCart(cart);
  return cart;
};

document.getElementById('apply-promo').addEventListener('click', async () => {
  const code = document.getElementById('promo-input').value;
  try {
    await api('/api/cart/promo', { method: 'POST', body: JSON.stringify({ code }) });
    showMessage('Промокод применён', 'success');
    await loadCart();
  } catch (e) {
    showMessage(e.message);
  }
});

document.getElementById('checkout-btn').addEventListener('click', async () => {
  try {
    const cart = await api('/api/cart');
    const order = await api('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ total: cart.total }),
    });
    document.getElementById('order-id').textContent = order.id;
    document.getElementById('order-total').textContent = formatPrice(order.total);
    document.getElementById('order-modal').classList.add('open');
    await loadCart();
  } catch (e) {
    showMessage(e.message);
  }
});

document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('order-modal').classList.remove('open');
});

loadProducts();
loadCart();
