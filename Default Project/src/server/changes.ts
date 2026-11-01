import type { Bug, DiffLine } from '../shared/types.js';

interface RawChange {
  title: string;
  file: string;
  /** what the agent says the change does */
  summary: string;
  /** line number of the first line of the hunk */
  start: number;
  /** ' ' context, '-' removed, '+' added; '!' is an added line that hides the bug */
  diff: string[];
  /** how the bug works, for changes that hide one */
  bug?: string;
}

export interface Change {
  title: string;
  file: string;
  summary: string;
  lines: DiffLine[];
  bug: Bug | null;
}

const RAW: RawChange[] = [
  // ---------- clean ----------
  {
    title: 'Rename usr to user on the profile page',
    file: 'src/pages/Profile.tsx',
    summary: 'Just a rename for readability. No behaviour change.',
    start: 8,
    diff: [
      ' export function Profile({ id }: { id: string }) {',
      '-  const usr = useUser(id);',
      '-  if (!usr) return <Spinner />;',
      '-  return <h1>{usr.name}</h1>;',
      '+  const user = useUser(id);',
      '+  if (!user) return <Spinner />;',
      '+  return <h1>{user.name}</h1>;',
      ' }',
    ],
  },
  {
    title: 'Default the page size to 25',
    file: 'src/api/params.ts',
    summary: 'The limit query parameter is now optional (default 25) and is kept between 1 and 100.',
    start: 15,
    diff: [
      ' export function pageSize(query: { limit?: string }): number {',
      '-  return Number(query.limit);',
      "+  const limit = Number.parseInt(query.limit ?? '25', 10);",
      '+  if (Number.isNaN(limit)) return 25;',
      '+  return Math.min(Math.max(limit, 1), 100);',
      ' }',
    ],
  },
  {
    title: 'Debounce the search box',
    file: 'src/components/Search.tsx',
    summary: 'Search used to fire on every keystroke. Now it waits until you stop typing for 300 ms.',
    start: 11,
    diff: [
      ' export function Search({ onSearch }: { onSearch: (q: string) => void }) {',
      "   const [text, setText] = useState('');",
      '+  useEffect(() => {',
      '+    const t = setTimeout(() => onSearch(text), 300);',
      '+    return () => clearTimeout(t);',
      '+  }, [text, onSearch]);',
      '   return <input value={text} onChange={(e) => setText(e.target.value)} />;',
      ' }',
    ],
  },
  {
    title: 'Look up users by email',
    file: 'src/db/users.ts',
    summary: 'Finds a user by email. Emails are stored lowercase, so I normalise the input the same way.',
    start: 30,
    diff: [
      ' export async function findUserByEmail(email: string) {',
      "-  return db.query('SELECT * FROM users');",
      "+  const rows = await db.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [",
      '+    email.trim().toLowerCase(),',
      '+  ]);',
      '+  return rows[0] ?? null;',
      ' }',
    ],
  },
  {
    title: 'Paginate the activity feed',
    file: 'src/api/feed.ts',
    summary: 'The feed now loads 30 events at a time, newest first. Pages are numbered from 1.',
    start: 9,
    diff: [
      ' export async function feed(userId: string, page = 1) {',
      '+  const PER_PAGE = 30;',
      '   return db.events.findMany({',
      '     where: { userId },',
      "+    orderBy: { at: 'desc' },",
      '+    skip: (page - 1) * PER_PAGE,',
      '+    take: PER_PAGE,',
      '   });',
      ' }',
    ],
  },
  {
    title: 'Verify webhook signatures',
    file: 'src/webhooks/verify.ts',
    summary: 'Webhooks were accepted without checking who sent them. Now the HMAC signature has to match.',
    start: 1,
    diff: [
      "+import { createHmac, timingSafeEqual } from 'node:crypto';",
      '+',
      ' export function verifySignature(body: string, signature: string): boolean {',
      '-  return true;',
      "+  const expected = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');",
      '+  const a = Buffer.from(expected);',
      '+  const b = Buffer.from(signature);',
      '+  return a.length === b.length && timingSafeEqual(a, b);',
      ' }',
    ],
  },
  {
    title: 'Filter the sales report by date',
    file: 'reports/sales.py',
    summary: 'The sales report can now start from a given date. Without one it covers everything, like before.',
    start: 12,
    diff: [
      '-def sales_report(orders):',
      '+def sales_report(orders, since=None):',
      '+    if since is not None:',
      '+        orders = [o for o in orders if o.created_at >= since]',
      '     return summarize(orders)',
    ],
  },
  {
    title: "Cache each user's avatar link",
    file: 'src/users/avatar.ts',
    summary: 'Signing avatar links is slow. The links stay valid for an hour, so I cache each one for 5 minutes.',
    start: 6,
    diff: [
      ' export async function avatarUrl(userId: string): Promise<string> {',
      "+  const key = `avatar:${userId}`;",
      '+  const cached = await cache.get(key);',
      '+  if (cached) return cached;',
      "   const url = await storage.signedUrl(`avatars/${userId}.png`, { expiresIn: 3600 });",
      '+  await cache.set(key, url, { ttl: 300 });',
      '   return url;',
      ' }',
    ],
  },
  {
    title: 'Return 404 for missing posts',
    file: 'src/api/posts.ts',
    summary: 'Opening a deleted post crashed with a 500. Now it gets a proper 404.',
    start: 40,
    diff: [
      ' export async function getPost(req: Request, res: Response) {',
      '   const post = await db.posts.find(req.params.id);',
      '+  if (!post) {',
      "+    return res.status(404).send('Post not found');",
      '+  }',
      '   res.json(post);',
      ' }',
    ],
  },
  {
    title: 'Sort products by price',
    file: 'src/catalog/sort.ts',
    summary: 'Products can now be sorted by price, either way. The original list is left untouched.',
    start: 3,
    diff: [
      " export function byPrice(products: Product[], dir: 'asc' | 'desc'): Product[] {",
      '-  return products;',
      '+  const sorted = [...products].sort((a, b) => a.priceCents - b.priceCents);',
      "+  return dir === 'asc' ? sorted : sorted.reverse();",
      ' }',
    ],
  },
  {
    title: 'Rate-limit login attempts',
    file: 'src/api/auth.ts',
    summary: 'Blocks password guessing: at most 5 login attempts per IP address per minute.',
    start: 10,
    diff: [
      ' export async function login(req: Request, res: Response) {',
      "+  const key = `login:${req.ip}`;",
      '+  const attempts = await redis.incr(key);',
      '+  if (attempts === 1) await redis.expire(key, 60);',
      "+  if (attempts > 5) return res.status(429).send('Too many attempts. Try again in a minute.');",
      '   const { email, password } = req.body;',
    ],
  },
  {
    title: 'Escape names in invite emails',
    file: 'src/email/templates.ts',
    summary: 'User and team names went into invite emails as raw HTML. Now they are escaped.',
    start: 1,
    diff: [
      "+import { escapeHtml } from '../util/html';",
      '+',
      ' export function inviteEmail(inviter: User, team: Team): string {',
      '-  return `<p>${inviter.name} invited you to ${team.name}</p>`;',
      '+  return `<p>${escapeHtml(inviter.name)} invited you to ${escapeHtml(team.name)}</p>`;',
      ' }',
    ],
  },
  {
    title: 'Parse prices without floating-point errors',
    file: 'billing/money.py',
    summary: 'float("19.99") * 100 is 1998.9999…, which int() turns into 1998. Decimal gets 1999.',
    start: 1,
    diff: [
      '+from decimal import Decimal, ROUND_HALF_UP',
      '+',
      ' def to_cents(amount: str) -> int:',
      '-    return int(float(amount) * 100)',
      '+    cents = Decimal(amount) * 100',
      '+    return int(cents.quantize(Decimal("1"), rounding=ROUND_HALF_UP))',
    ],
  },
  {
    title: 'Format invoice dates as YYYY-MM-DD',
    file: 'src/billing/format.ts',
    summary: 'Invoices showed dates like "Tue Mar 05 2024 00:00:00 GMT". Now they show 2024-03-05.',
    start: 20,
    diff: [
      ' export function invoiceDate(d: Date): string {',
      '-  return d.toString();',
      "+  const pad = (n: number) => String(n).padStart(2, '0');",
      '+  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;',
      ' }',
    ],
  },
  {
    title: 'Load profile data in parallel',
    file: 'src/pages/profileData.ts',
    summary: 'The user and their posts were fetched one after the other. Fetching both at once halves the wait.',
    start: 4,
    diff: [
      ' export async function loadProfile(id: string) {',
      '-  const user = await api.user(id);',
      '-  const posts = await api.posts(id);',
      '+  const [user, posts] = await Promise.all([api.user(id), api.posts(id)]);',
      '   return { user, posts };',
      ' }',
    ],
  },
  {
    title: 'Remove the old checkout flag',
    file: 'src/checkout/index.tsx',
    summary: 'The new checkout has been on for every customer since March, so the flag and the old page can go.',
    start: 14,
    diff: [
      ' export function CheckoutPage() {',
      '-  if (flags.newCheckout) {',
      '-    return <NewCheckout />;',
      '-  }',
      '-  return <LegacyCheckout />;',
      '+  return <NewCheckout />;',
      ' }',
    ],
  },

  // ---------- hiding a bug ----------
  {
    title: 'Paginate the orders list',
    file: 'src/api/orders.ts',
    summary: 'Orders now load 20 at a time, newest first. Pages are numbered from 1.',
    start: 12,
    diff: [
      ' export async function listOrders(userId: string, page = 1) {',
      '-  return db.orders.findMany({ where: { userId } });',
      '+  const PAGE_SIZE = 20;',
      '+  return db.orders.findMany({',
      '+    where: { userId },',
      "+    orderBy: { createdAt: 'desc' },",
      '!    skip: page * PAGE_SIZE,',
      '+    take: PAGE_SIZE,',
      '+  });',
      ' }',
    ],
    bug: 'Pages are numbered from 1, so page 1 skips the first 20 orders: nobody ever sees their newest ones. It should skip (page - 1) * PAGE_SIZE.',
  },
  {
    title: 'Expire password-reset links after 30 minutes',
    file: 'src/auth/reset.ts',
    summary: 'Reset links used to work forever. Now they stop working 30 minutes after they are sent.',
    start: 40,
    diff: [
      ' export function isResetTokenValid(token: ResetToken): boolean {',
      '   if (!token || token.used) return false;',
      '+  const ageMs = Date.now() - token.createdAt.getTime();',
      '!  if (ageMs < 30 * 60 * 1000) return false;',
      '   return true;',
      ' }',
    ],
    bug: 'The comparison is backwards: links under 30 minutes old are rejected and old ones work forever. It should be ageMs > 30 * 60 * 1000.',
  },
  {
    title: 'Send a welcome email on sign-up',
    file: 'src/api/signup.ts',
    summary: 'New users get a welcome email. If sending fails we log it and carry on, so sign-up never breaks.',
    start: 18,
    diff: [
      ' export async function signUp(req: Request, res: Response) {',
      '   const user = await createUser(req.body);',
      '+  try {',
      '!    sendWelcomeEmail(user.email);',
      '+  } catch (err) {',
      "+    logger.warn('welcome email failed', err);",
      '+  }',
      '   res.status(201).json({ id: user.id });',
      ' }',
    ],
    bug: "sendWelcomeEmail is async but isn't awaited, so the try/catch never sees it fail. A failed email becomes an unhandled promise rejection, which crashes the server.",
  },
  {
    title: 'Let shops set their own shipping fee',
    file: 'src/checkout/shipping.ts',
    summary: "Shops can now set a custom shipping fee. If they haven't set one, we use the standard fee.",
    start: 7,
    diff: [
      ' export function shippingFee(shop: Shop): number {',
      '-  return STANDARD_FEE;',
      '!  return shop.shippingFeeCents || STANDARD_FEE;',
      ' }',
    ],
    bug: 'Shops offering free shipping set the fee to 0, and 0 || STANDARD_FEE is the standard fee, so their customers get charged anyway. It should use ?? instead of ||.',
  },
  {
    title: 'Show the highest scores first',
    file: 'src/game/leaderboard.ts',
    summary: 'The leaderboard was in sign-up order. Now it shows the top 10 scores, highest first.',
    start: 3,
    diff: [
      ' export function topScores(scores: number[], n = 10): number[] {',
      '-  return scores.slice(0, n);',
      '!  return [...scores].sort().reverse().slice(0, n);',
      ' }',
    ],
    bug: 'sort() with no comparator sorts numbers as strings, so 9 ranks above 1000. It needs sort((a, b) => b - a).',
  },
  {
    title: 'Search products by name',
    file: 'src/api/products.ts',
    summary: 'The search box now filters products by name, ignoring case.',
    start: 25,
    diff: [
      ' export async function searchProducts(query: string) {',
      "-  return db.query('SELECT * FROM products LIMIT 50');",
      '+  return db.query(',
      "!    `SELECT * FROM products WHERE name ILIKE '%${query}%' LIMIT 50`,",
      '+  );',
      ' }',
    ],
    bug: "The search text is pasted straight into the SQL, so searching for ' ; DROP TABLE products; -- runs as SQL. It needs a parameter: WHERE name ILIKE $1.",
  },
  {
    title: 'Show the renewal date on the billing page',
    file: 'src/billing/renewal.ts',
    summary: 'Subscriptions renew on the same day next month. This formats that date for the billing page.',
    start: 9,
    diff: [
      ' export function renewalDate(start: Date): string {',
      "-  return '';",
      '+  const next = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate());',
      '!  return `${next.getFullYear()}-${next.getMonth()}-${next.getDate()}`;',
      ' }',
    ],
    bug: 'getMonth() counts from 0, so a renewal on 5 April shows as 2024-3-5, a month early. It needs getMonth() + 1.',
  },
  {
    title: 'Retry failed card payments',
    file: 'src/payments/charge.ts',
    summary: 'The payment gateway sometimes times out. Charges now retry up to 3 times before giving up.',
    start: 30,
    diff: [
      ' export async function charge(card: Card, cents: number): Promise<Receipt> {',
      '-  return gateway.charge(card, cents);',
      '+  for (let attempt = 1; ; attempt++) {',
      '+    try {',
      '!      return await gateway.charge(card, cents);',
      '+    } catch (err) {',
      '+      if (attempt === 3) throw err;',
      '+    }',
      '+  }',
      ' }',
    ],
    bug: "A timeout doesn't mean the charge failed: it may have gone through. Retrying with no idempotency key can bill the same card two or three times.",
  },
  {
    title: 'Cache the dashboard for a minute',
    file: 'src/api/dashboard.ts',
    summary: 'Building the dashboard is slow, so I cache it for 60 seconds.',
    start: 14,
    diff: [
      ' export async function getDashboard(userId: string) {',
      "!  const cached = cache.get('dashboard');",
      '+  if (cached) return cached;',
      '   const data = await buildDashboard(userId);',
      "+  cache.set('dashboard', data, { ttl: 60 });",
      '   return data;',
      ' }',
    ],
    bug: "The cache key doesn't include the user, so whoever loads the dashboard first gets cached and everyone else sees their data for the next minute.",
  },
  {
    title: 'Log failed logins',
    file: 'src/auth/login.ts',
    summary: 'Support asked for more detail on failed logins, so I log each one.',
    start: 52,
    diff: [
      '   const user = await findUserByEmail(email);',
      '   if (!user || !(await verifyPassword(user, password))) {',
      "!    logger.info('login failed', { email, password, ip: req.ip });",
      "     return res.status(401).send('Wrong email or password');",
      '   }',
    ],
    bug: 'It logs the password people typed, in plain text. Anyone who can read the logs can read real passwords, including typos one letter away from the right one.',
  },
  {
    title: 'Tag new support tickets',
    file: 'support/tickets.py',
    summary: 'Every new ticket gets a "new" tag so the team can triage it, and callers can pass their own tags.',
    start: 18,
    diff: [
      '-def create_ticket(title):',
      '-    return Ticket(title=title)',
      '!def create_ticket(title, tags=[]):',
      '+    tags.append("new")',
      '+    return Ticket(title=title, tags=tags)',
    ],
    bug: 'The default list is created once and shared by every call, so tickets end up sharing one ever-growing tag list. It should default to None and make a new list.',
  },
  {
    title: 'Split the bill evenly',
    file: 'billing/split.py',
    summary: 'Splits a bill between people. Everything is in whole cents, so there are no floating-point issues.',
    start: 4,
    diff: [
      ' def split_bill(total_cents, people):',
      '-    raise NotImplementedError',
      '!    share = total_cents // people',
      '+    return [share] * people',
    ],
    bug: 'Integer division drops the remainder: 1000 cents split 3 ways is 333 × 3 = 999, so a cent disappears. The leftover cents have to go to someone.',
  },
  {
    title: 'Stop banned users from posting',
    file: 'src/api/posts.ts',
    summary: 'Banned users now get a 403 when they try to post.',
    start: 21,
    diff: [
      ' export async function createPost(req: Request, res: Response) {',
      '+  if (req.user.banned) {',
      "!    res.status(403).send('You are banned');",
      '+  }',
      '   const post = await db.posts.create({ authorId: req.user.id, body: req.body.text });',
      '   res.status(201).json(post);',
      ' }',
    ],
    bug: "There's no return after the 403, so the function carries on: the banned user's post is still created (and sending a second response throws).",
  },
  {
    title: 'Validate usernames',
    file: 'src/users/validate.ts',
    summary: 'Usernames must be 3–16 letters, digits or underscores.',
    start: 1,
    diff: [
      '!const USERNAME = /[a-z0-9_]{3,16}/i;',
      '+',
      ' export function isValidUsername(name: string): boolean {',
      '-  return name.length > 0;',
      '+  return USERNAME.test(name);',
      ' }',
    ],
    bug: "The pattern isn't anchored with ^ and $, so any 3 valid characters anywhere will do: '<script>alert(1)</script>' and a 300-character name both pass.",
  },
  {
    title: 'Remove items from the cart',
    file: 'src/cart/cart.ts',
    summary: 'Adds removeItem, which returns a new cart without the given product.',
    start: 33,
    diff: [
      '+export function removeItem(cart: CartItem[], sku: string): CartItem[] {',
      '+  const i = cart.findIndex((item) => item.sku === sku);',
      '+  const next = [...cart];',
      '!  next.splice(i, 1);',
      '+  return next;',
      '+}',
    ],
    bug: "If the product isn't in the cart, findIndex returns -1 and splice(-1, 1) removes the last item instead of doing nothing.",
  },
  {
    title: 'Expire sessions after a day',
    file: 'src/auth/session.ts',
    summary: 'Sessions used to last forever. Now they expire 24 hours after sign-in.',
    start: 5,
    diff: [
      ' // createdAt is milliseconds since the epoch',
      ' interface Session { userId: string; createdAt: number }',
      '+',
      '!const SESSION_TTL = 24 * 60 * 60; // one day',
      '+',
      ' export function isSessionValid(session: Session): boolean {',
      '-  return true;',
      '+  return Date.now() - session.createdAt < SESSION_TTL;',
      ' }',
    ],
    bug: "SESSION_TTL is in seconds but Date.now() is in milliseconds, so sessions expire after 86 seconds instead of a day. It should be 24 * 60 * 60 * 1000.",
  },
];

function parse(raw: RawChange): Change {
  let oldNo = raw.start;
  let newNo = raw.start;
  const lines: DiffLine[] = [];
  const bugLines: number[] = [];
  for (const src of raw.diff) {
    const mark = src[0];
    const text = src.slice(1);
    if (mark === '!') bugLines.push(lines.length);
    if (mark === '-') lines.push({ kind: 'del', text, oldNo: oldNo++, newNo: null });
    else if (mark === '+' || mark === '!') lines.push({ kind: 'add', text, oldNo: null, newNo: newNo++ });
    else if (mark === ' ') lines.push({ kind: 'ctx', text, oldNo: oldNo++, newNo: newNo++ });
    else throw new Error(`${raw.title}: bad diff marker ${JSON.stringify(mark)}`);
  }
  const bugLine = bugLines[0] ?? null;
  if (bugLines.length > 1 || (bugLine === null) !== (raw.bug === undefined)) {
    throw new Error(`${raw.title}: a bug needs exactly one '!' line, and a '!' line needs a bug`);
  }
  return {
    title: raw.title,
    file: raw.file,
    summary: raw.summary,
    lines,
    bug: bugLine === null ? null : { line: bugLine, explanation: raw.bug! },
  };
}

export const CHANGES: readonly Change[] = RAW.map(parse);
