'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Gift, Loader2, Tag } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';

interface Props {
  productId: string;
  productName: string;
  unitPrice: number;
  soldOut: boolean;
  maxQuantity: number;
  allowGift: boolean;
}

interface CouponResult {
  code: string;
  discount: number;
  label: string;
}

export function Checkout({
  productId,
  productName,
  unitPrice,
  soldOut,
  maxQuantity,
  allowGift,
}: Props) {
  const { user } = useAuth();

  const [quantity, setQuantity] = useState(1);
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const [giftOpen, setGiftOpen] = useState(false);
  const [giftToIgn, setGiftToIgn] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  // Held in a ref so React re-renders do not mint a new key mid-checkout.
  const idempotencyKey = useRef<string>(
    typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Date.now()),
  );

  const subtotal = unitPrice * quantity;
  const discount = coupon?.discount ?? 0;
  const total = Math.max(0, subtotal - discount);

  async function applyCoupon() {
    if (!couponCode.trim()) return;
    setCheckingCoupon(true);
    setCouponError(null);

    try {
      const result = await api<CouponResult>('/store/coupon/check', {
        method: 'POST',
        body: { code: couponCode.trim().toUpperCase(), subtotal },
      });
      setCoupon(result);
    } catch (err) {
      setCoupon(null);
      setCouponError(err instanceof ApiRequestError ? err.message : 'That code could not be checked.');
    } finally {
      setCheckingCoupon(false);
    }
  }

  async function checkout() {
    setBusy(true);
    setError(null);

    try {
      const order = await api<{ reference: string }>('/store/checkout', {
        method: 'POST',
        body: {
          items: [{ productId, quantity }],
          couponCode: coupon?.code,
          giftToIgn: giftOpen && giftToIgn.trim() ? giftToIgn.trim() : undefined,
          idempotencyKey: idempotencyKey.current,
        },
      });
      setReference(order.reference);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Checkout could not be completed. You have not been charged.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (reference) {
    return (
      <div className="rounded-xl border border-neon/35 bg-neon/8 p-5">
        <p className="font-display text-sm font-bold uppercase tracking-wide">Order placed</p>
        <p className="mt-2 font-body text-sm leading-relaxed text-muted">
          Reference <span className="font-mono text-ink">{reference}</span>. Delivery starts as soon
          as payment clears.
        </p>
        <Button asChild variant="ghost" className="mt-5 w-full">
          <Link href="/dashboard/orders">View order</Link>
        </Button>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Button asChild className="w-full">
          <Link href={`/login?next=${encodeURIComponent('/store')}`}>Sign in to buy</Link>
        </Button>
        <p className="mt-3 text-center font-body text-xs text-muted">
          Accounts are free and take a moment to create.
        </p>
      </>
    );
  }

  return (
    <div className="space-y-5">
      {/* Quantity */}
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="qty" className="font-display text-eyebrow font-bold uppercase text-muted">
          Quantity
        </label>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Decrease quantity"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          >
            −
          </Button>
          <input
            id="qty"
            type="number"
            min={1}
            max={maxQuantity}
            value={quantity}
            onChange={(e) =>
              setQuantity(Math.min(maxQuantity, Math.max(1, Number(e.target.value) || 1)))
            }
            className="field w-20 text-center font-mono tabular"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Increase quantity"
            disabled={quantity >= maxQuantity}
            onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
          >
            +
          </Button>
        </div>
      </div>

      {/* Coupon */}
      <div>
        <label htmlFor="coupon" className="mb-2 flex items-center gap-2 font-display text-eyebrow font-bold uppercase text-muted">
          <Tag className="h-3 w-3" aria-hidden />
          Coupon
        </label>
        <div className="flex gap-2">
          <input
            id="coupon"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            placeholder="OPTIONAL"
            className="field flex-1 font-mono uppercase tracking-widest"
          />
          <Button variant="ghost" onClick={() => void applyCoupon()} disabled={checkingCoupon}>
            {checkingCoupon ? '…' : 'Apply'}
          </Button>
        </div>
        {couponError && <p className="mt-2 font-body text-xs text-heart">{couponError}</p>}
        {coupon && <p className="mt-2 font-body text-xs text-neon">{coupon.label} applied.</p>}
      </div>

      {/* Gift */}
      {allowGift && (
        <div>
          <button
            type="button"
            onClick={() => setGiftOpen((v) => !v)}
            aria-expanded={giftOpen}
            className="flex items-center gap-2 font-display text-eyebrow font-bold uppercase tracking-widest text-muted transition-colors hover:text-ink"
          >
            <Gift className="h-3 w-3" aria-hidden />
            {giftOpen ? 'Buying for myself' : 'Buying as a gift'}
          </button>

          {giftOpen && (
            <div className="mt-3">
              <label htmlFor="gift" className="sr-only">
                Recipient Minecraft username
              </label>
              <input
                id="gift"
                value={giftToIgn}
                onChange={(e) => setGiftToIgn(e.target.value)}
                placeholder="Their Minecraft username"
                className="field"
              />
              <p className="mt-2 font-body text-xs text-muted">
                Delivered to them, not you. Check the spelling — we cannot move it afterwards.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="rule" />

      {/* Totals */}
      <dl className="space-y-2 font-body text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">
            {productName} × {quantity}
          </dt>
          <dd className="font-mono tabular text-muted">{money(subtotal)}</dd>
        </div>
        {discount > 0 && (
          <div className="flex justify-between">
            <dt className="text-neon">Discount</dt>
            <dd className="font-mono tabular text-neon">−{money(discount)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-edge pt-2">
          <dt className="font-display text-eyebrow font-bold uppercase tracking-widest text-muted">
            Total
          </dt>
          <dd className="font-mono text-lg tabular text-ink">{money(total)}</dd>
        </div>
      </dl>

      {error && (
        <p role="alert" className="rounded-xl border border-heart/40 bg-heart/8 px-4 py-3 font-body text-sm">
          {error}
        </p>
      )}

      <Button onClick={() => void checkout()} disabled={soldOut || busy} className="w-full" size="lg">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {soldOut ? 'Sold out' : busy ? 'Placing order…' : 'Checkout'}
      </Button>

      <p className="text-center font-body text-xs text-muted">
        Payment is handled by our provider. We never see your card details.
      </p>
    </div>
  );
}
