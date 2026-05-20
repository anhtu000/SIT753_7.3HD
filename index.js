const path = require('path');
const client = require('prom-client');
const express = require('express');
const morgan = require("morgan");
//used for sending email OTP
const nodemailer = require('nodemailer');
//Used for generating random OTP
const crypto = require('crypto')
const Stripe = require('stripe');
//load .env for reading stripe secret key
require('dotenv').config();


const app = express();
const port = process.env.PORT || 3000;
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const db = new sqlite3.Database('myHDDB.db', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to existing database.');
  }
});
//create an account to send the email from
let transporter = null;

if (process.env.SKIP_EMAIL !== 'true' && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}
// Read in stripe secret key
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy_key_for_local_tests';
const stripe = Stripe(stripeSecretKey);

// Middleware
app.use(morgan("common"));
app.use(express.urlencoded({ extended: true }));
// Add JSON parser for AJAX requests, use json to send multiple value with clear structure instead of plain text
app.use(express.json()); 
app.set('view engine', 'ejs');
//allow the use of session
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: true
}));
//allow the views to have session
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});
app.set('views', path.join(__dirname, 'views'));

//generate random OTP to send
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

//get the expiry datetime for the OTP
function getExpiryTime() {
  //cast the datetime to the correct format for the database to read
  return new Date(Date.now() + 5 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

client.collectDefaultMetrics();

const httpRequestCounter = new client.Counter({
  name: 'flow_http_requests_total',
  help: 'Total HTTP requests handled by FLOW app',
  labelNames: ['method', 'path', 'status']
});

app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestCounter.inc({
      method: req.method,
      path: req.path,
      status: res.statusCode
    });
  });
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    app: 'flow-retail',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

//Get route
// Homepage 
app.get('/', (req, res) => {
  res.render('DProject_Home', {
    user: req.session.user || null
  });
});

// Cart page
app.get('/DProject_Cart', (req, res) => {
  // Check if user is logged in, only logged in user can use cart. redirect to login page
  if (!req.session.user) {
    return res.redirect('/DProject_Login');
  }

  const username = req.session.user.username;

  // Get cart items with product details
  db.all(
    `SELECT 
      Cart.id as cart_id,
      Cart.quantity,
      Products.id as product_id,
      Products.prd_name,
      Products.prd_code,
      Products.prd_price,
      Products.prd_description,
      Products.prd_image,
      Products.prd_stock
    FROM Cart
    INNER JOIN Products ON Cart.product_id = Products.id
    WHERE Cart.username = ?
    ORDER BY Cart.added_at DESC`,
    [username],
    (err, cartItems) => {
      if (err) {
        console.error(err.message);
        return res.render('DProject_Cart', {
          cartItems: [],
          error: "Database error",
          user: req.session.user || null,
          cartSummary: { totalItems: 0, subtotal: 0, shipping: 5, total: 5 }
        });
      }

      // Calculate totals
      let totalItems = 0;
      let subtotal = 0;

      //calculate based on current items on cart
      cartItems.forEach(item => {
        totalItems += item.quantity;
        subtotal += item.prd_price * item.quantity;
      });
      //fixed 5$ shipping cost, calculate into total price
      const shipping = 5;
      const total = subtotal + shipping;

      res.render('DProject_Cart', {
        cartItems: cartItems,
        error: null,
        user: req.session.user || null,
        cartSummary: {
          totalItems: totalItems,
          subtotal: subtotal.toFixed(2),
          shipping: shipping.toFixed(2),
          total: total.toFixed(2)
        }
      });
    }
  );
});

// Product list page
app.get('/DProject_ProductList', (req, res) => {
  db.all("SELECT * FROM Products", [], (err, rows) => {
    if (err) {
      console.error(err.message);
      return res.render('DProject_ProductList', {
        products: [],
        error: "Database error",
        user: req.session.user || null
      });
    }

    res.render('DProject_ProductList', {
      products: rows,
      error: null,
      user: req.session.user || null
    });
  });
});

//Product detail page
app.get('/DProject_ProductDetail', (req, res) => {
  res.render('DProject_ProductDetail', {
    user: req.session.user || null
  });
});

//Checkout page
app.get('/DProject_Checkout', (req, res) => {
  // Check if user is logged in. only logged in user can check out
  if (!req.session.user) {
    return res.redirect('/DProject_Login');
  }

  const username = req.session.user.username;

  // Get cart items for checkout
  db.all(
    `SELECT 
      Cart.quantity,
      Products.prd_name,
      Products.prd_price,
      Products.prd_image
    FROM Cart
    INNER JOIN Products ON Cart.product_id = Products.id
    WHERE Cart.username = ?`,
    [username],
    (err, cartItems) => {
      if (err) {
        console.error(err.message);
        return res.redirect('/DProject_Cart');
      }

      // Calculate totals
      let subtotal = 0;
      cartItems.forEach(item => {
        subtotal += item.prd_price * item.quantity;
      });
      // Add shipping price
      const shipping = 5;
      const total = subtotal + shipping;

      res.render('DProject_Checkout', {
        user: req.session.user || null,
        cartItems: cartItems,
        cartSummary: {
          subtotal: subtotal.toFixed(2),
          shipping: shipping.toFixed(2),
          total: total.toFixed(2)
        }
      });
    }
  );
});

//Login page
app.get('/DProject_Login', (req, res) => {
  res.render('DProject_Login', {
    
  });
});

//verify OTP
app.get('/verify-otp', (req, res) => {
  // No username in session → back to login
  if (!req.session.tempUsername) {
    return res.redirect('/DProject_Login');
  }

  res.render('VerifyOTP', { error: null });
});

//Signup page
app.get('/DProject_Signup', (req, res) => {
    res.render('DProject_Signup', { 
      oldData: {}, 
      errors: {} 
    });
});

//CS page
app.get('/DProject_CS', (req, res) => {
  res.render('DProject_CS', {
    
  });
});

//About page
app.get('/DProject_About', (req, res) => {
  res.render('DProject_About', {
    
  });
});


//Post route
//Login
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  //check empty
  if (!username || !password) {
    return res.render('DProject_Login', { error: 'Username and password cannot be empty.' });
    }
  // Query user
  db.get(
    //select in the table a row with the user name and password = user input
    "SELECT * FROM User WHERE username = ? AND password = ?",
    [username, password],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.send('Database error');
      }
      //check if there is a row exist, if true -> send OTP
      if (row) {
        const otp = generateOTP();
        const expiresAt = getExpiryTime();
        //insert the OTP into the database table
        db.run(
          `INSERT INTO EmailOTP (username, otp, expires_at)
          VALUES (?, ?, ?)`,
          [row.username, otp, expiresAt],
          (err) => {
            if (err) {
              console.error(err);
              return res.render('DProject_Login', { error: 'OTP error' });
            }
            //insert success -> send mail from the earlier declared account
            if (transporter) {
              transporter.sendMail({
                to: row.email,
                subject: 'Your OTP Code',
                text: `Your OTP is ${otp}. It expires in 5 minutes.`
              }).catch((mailErr) => {
                console.error('Email sending failed:', mailErr.message);
              });
            } else {
              console.log(`Email disabled. OTP for ${row.username}: ${otp}`);
            }

            // save username into session for later verify in the VerifyOTP ejs
            req.session.tempUsername = row.username;

            res.redirect('/verify-otp');
          }
        );
      }
      //else send an error
      else 
      {
        res.render('DProject_Login', { error: 'Invalid username or password.' });
      }
    }
  );
});

//verify OTP
app.post('/verify-otp', (req, res) => {
  //get the otp from the request body
  const otp = req.body.otp;

  const username = req.session.tempUsername;
  //query the database using the otp from the request body and the username saved in the request session
  db.get(
    `SELECT * FROM EmailOTP
     WHERE username = ?
       AND otp = ?
       AND is_used = 0
       AND expires_at > CURRENT_TIMESTAMP`,
    [username, otp],
    (err, row) => {
      if (!row) {
        return res.render('VerifyOTP', { error: 'OTP invalid or expired' });
      }
      //update the OTP from 0 to 1 -> unused to used
      db.run(
        `UPDATE EmailOTP SET is_used = 1 WHERE id = ?`,
        [row.id]
      );

      req.session.user = { username };
      delete req.session.tempUsername;

      res.redirect('/');
    }
  );
});

//Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

//submit feedback on customer service page
app.post('/submitfeedback', (req, res) => {
  const { message } = req.body;

  // empty message error
  if (!message || message.trim() === '') {
    return res.render('DProject_CS', 
    { 
      error: 'Message cannot be empty.', 
      success: null, 
    });
  }
  // insert into database
  db.run(
    `INSERT INTO Feedback (message) VALUES (?)`,
    [message.trim()],
    function(err) {
      if (err) {
        console.error('Database error:', err.message);
        return res.render('DProject_CS', { 
            error: 'Database error. Please try again.', 
            success: null, 
        });
      }

      // Submit success
      res.render('DProject_CS', { 
        success: 'Message submitted successfully!', 
        error: null, 
        message: '' // reset textarea
      });
    }
  );
});

//search product
app.post('/DProject_ProductList', (req, res) => {
  const search = req.body.search?.trim();

  let sql = "SELECT * FROM Products";
  let params = [];

  if (search) {
    sql += " WHERE prd_name LIKE ?";
    params.push(`%${search}%`);
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err.message);
      return res.render('DProject_ProductList', {
        products: [],
        error: "Database error",
        user: req.session.user || null
      });
    }

    res.render('DProject_ProductList', {
      products: rows,
      error: null,
      user: req.session.user || null
    });
  });
});

//user register 
app.post('/signup', (req, res) => {
  const {
    username,
    password,
    repassword,
    firstname,
    surname,
    email,
    mobile,
    birthdate,
    address,
    city,
    state,
    postcode,
    newsletter,
    ads,
    term
  } = req.body;

  let errors = {};

  // --- 1. Validation ---
  // Username
  if (!username || username.trim().length === 0) 
  {
    errors.username = 'Username is required';
  }

  // Password
  if (!password || password.length < 8) 
  {
    errors.password = 'Password must be at least 8 characters';
  }

  // Retype password
  if (password !== repassword) 
  {
    errors.repassword = 'Passwords do not match';
  }

  // Firstname & Surname
  if (!firstname || firstname.trim().length === 0) 
  {
    errors.firstname = 'Firstname is required';
  }
  if (!surname || surname.trim().length === 0) 
  {
    errors.surname = 'Surname is required';
  }

  // Email
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) 
  {
    errors.email = 'Valid email is required';
  }

  // Mobile
  if (!mobile || !/^\d{8,15}$/.test(mobile)) 
  {
    errors.mobile = 'Valid mobile number is required (8-15 digits)';
  }

  // Birthdate
  if (!birthdate) 
  {
    errors.birthdate = 'Birth date is required';
  }

  // Address
  if (!address || address.trim().length === 0) 
  {
    errors.address = 'Address is required';
  }

  // City/Suburb
  if (!city || city.trim().length === 0) 
  {
    errors.city = 'Suburb is required';
  }

  // State
  if (!state || state === 'Choose...') 
  {
    errors.state = 'State selection is required';
  }

  // Postcode
  if (!postcode || postcode.trim().length === 0) 
  {
    errors.postcode = 'Suburb is required';
  }

  // Terms
  if (!term) 
  {
    errors.term = 'You must agree to terms';
  }

  // If exist validation error-> render signup page again with the same data
  if (Object.keys(errors).length > 0) {
    return res.render('DProject_Signup', { 
      errors, 
      oldData: req.body 
    });
  }

  // check if username exist in database
  db.get('SELECT * FROM User WHERE username = ?', [username], (err, row) => {
    console.log("INPUT USERNAME:", username);
    console.log("DB ROW:", row);
    if (err) {
      console.error(err);
      return res.render('DProject_Signup', { 
        errors: 
        { 
          general: 'Database error' 
        }, 
        oldData: req.body 
      });
    }

    if (row) {
      return res.render('DProject_Signup', { 
        errors: 
        { 
          username: 'Username already exists' 
        }, 
        oldData: req.body });
    }

    // insert into user
    db.run('INSERT INTO User (username, password, email) VALUES (?, ?, ?)', [username, password, email], function (err) {
      if (err) {
          console.error(err);
          return res.render('DProject_Signup', { 
            errors: 
            { 
              general: 'Cannot create user' 
            }, 
            oldData: req.body });
      }

      // insert into customer
      db.run(
        `INSERT INTO Customer 
            (cus_fname, cus_sname, cus_email, cus_mobile, cus_bdate, cus_addr, cus_suburb, cus_state) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          firstname,
          surname,
          email,
          mobile,
          birthdate,
          address,
          city,
          state,
        ],
        (err) => {
          if (err) {
            console.error(err);
            return res.render('DProject_Signup', { 
              errors: 
              { 
                general: 'Cannot create customer' 
              }, 
              oldData: req.body 
            });
          }

          // success, redirect to login
          res.redirect('/DProject_Login');
        }
      );
    });
  });
});

// Add to cart
app.post('/cart/add', (req, res) => {
  // Check if user is logged in
  if (!req.session.user) {
    return res.json({ success: false, message: 'Please login first' });
  }

  const { product_id } = req.body;
  const username = req.session.user.username;

  // Validate product exists
  db.get('SELECT * FROM Products WHERE id = ?', [product_id], (err, product) => {
    if (err || !product) {
      return res.json({ success: false, message: 'Product not found' });
    }

    // Check if item already in cart
    db.get(
      'SELECT * FROM Cart WHERE username = ? AND product_id = ?',
      [username, product_id],
      (err, cartItem) => {
        if (err) {
          return res.json({ success: false, message: 'Database error' });
        }

        if (cartItem) {
          // Item exists, increase quantity
          db.run(
            'UPDATE Cart SET quantity = quantity + 1 WHERE username = ? AND product_id = ?',
            [username, product_id],
            (err) => {
              if (err) {
                return res.json({ success: false, message: 'Failed to update cart' });
              }
              return res.json({ success: true, message: 'Product quantity increased in cart' });
            }
          );
        } else {
          // Item doesn't exist, insert new
          db.run(
            'INSERT INTO Cart (username, product_id, quantity) VALUES (?, ?, 1)',
            [username, product_id],
            (err) => {
              if (err) {
                return res.json({ success: false, message: 'Failed to add to cart' });
              }
              return res.json({ success: true, message: 'Product added to cart' });
            }
          );
        }
      }
    );
  });
});

// Update cart quantity
app.post('/cart/update', (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, message: 'Please login first' });
  }

  const { cart_id, quantity } = req.body;
  const username = req.session.user.username;

  // Validate quantity
  if (quantity < 1) {
    return res.json({ success: false, message: 'Quantity must be at least 1' });
  }

  // Update quantity
  db.run(
    'UPDATE Cart SET quantity = ? WHERE id = ? AND username = ?',
    [quantity, cart_id, username],
    function(err) {
      if (err) {
        return res.json({ success: false, message: 'Failed to update quantity' });
      }
      
      if (this.changes === 0) {
        return res.json({ success: false, message: 'Cart item not found' });
      }

      // Get updated cart summary
      db.all(
        `SELECT 
          Cart.quantity,
          Products.prd_price
        FROM Cart
        INNER JOIN Products ON Cart.product_id = Products.id
        WHERE Cart.username = ?`,
        [username],
        (err, items) => {
          if (err) {
            return res.json({ success: false, message: 'Failed to get cart summary' });
          }

          let totalItems = 0;
          let subtotal = 0;

          items.forEach(item => {
            totalItems += item.quantity;
            subtotal += item.prd_price * item.quantity;
          });

          const shipping = 5;
          const total = subtotal + shipping;

          return res.json({
            success: true,
            message: 'Quantity updated',
            cartSummary: {
              totalItems: totalItems,
              subtotal: subtotal.toFixed(2),
              shipping: shipping.toFixed(2),
              total: total.toFixed(2)
            }
          });
        }
      );
    }
  );
});

// Remove from cart
app.post('/cart/remove', (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, message: 'Please login first' });
  }

  const { cart_id } = req.body;
  const username = req.session.user.username;

  db.run(
    'DELETE FROM Cart WHERE id = ? AND username = ?',
    [cart_id, username],
    function(err) {
      if (err) {
        return res.json({ success: false, message: 'Failed to remove item' });
      }

      if (this.changes === 0) {
        return res.json({ success: false, message: 'Cart item not found' });
      }

      return res.json({ success: true, message: 'Item removed from cart' });
    }
  );
});

// Clear cart
app.post('/cart/clear', (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, message: 'Please login first' });
  }

  const username = req.session.user.username;

  db.run(
    'DELETE FROM Cart WHERE username = ?',
    [username],
    function(err) {
      if (err) {
        return res.json({ success: false, message: 'Failed to clear cart' });
      }

      return res.json({ success: true, message: 'Cart cleared successfully' });
    }
  );
});

//Checkout - Create Stripe Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  console.log('Create checkout session request received');
  console.log('Request body:', req.body);

  // Check if user is logged in
  if (!req.session.user) {
    return res.status(401).json({ error: 'Please login first' });
  }

  const { collectionType, address, state, suburb, postcode, mobile, amount } = req.body;
  const username = req.session.user.username;

  // Validate amount
  if (!amount || amount < 1) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    // Get cart items for the order description
    const cartItems = await new Promise((resolve, reject) => {
      db.all(
        `SELECT Products.prd_name, Cart.quantity, Products.prd_price
         FROM Cart
         INNER JOIN Products ON Cart.product_id = Products.id
         WHERE Cart.username = ?`,
        [username],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Build line items from cart
    const line_items = cartItems.map(item => ({
      price_data: {
        currency: 'aud',
        product_data: {
          name: item.prd_name,
          description: `Quantity: ${item.quantity}`
        },
        unit_amount: Math.round(item.prd_price * 100), // Convert to cents
      },
      quantity: item.quantity,
    }));

    // Add shipping if delivery
    if (collectionType === 'delivery') {
      line_items.push({
        price_data: {
          currency: 'aud',
          product_data: {
            name: 'Shipping',
            description: `Delivery to ${suburb}, ${state}`
          },
          unit_amount: 500, // $5.00 in cents
        },
        quantity: 1,
      });
    }

    console.log('Creating Stripe session with line items:', line_items);

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: line_items,
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/payment-cancel`,
      metadata: {
        username: username,
        collectionType: collectionType,
        address: address || '',
        suburb: suburb || '',
        state: state || '',
        postcode: postcode || '',
        mobile: mobile || ''
      }
    });

    console.log('Stripe session created:', session.id);

    // Return sessionId to frontend
    res.json({ sessionId: session.id });

  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message || 'Payment processing failed' });
  }
});

// Payment Success Page
app.get('/payment-success', async (req, res) => {
  const sessionId = req.query.session_id;

  if (!req.session.user) {
    return res.redirect('/DProject_Login');
  }

  try {
    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    console.log('Payment successful:', session);

    // Clear the user's cart after successful payment
    const username = req.session.user.username;
    db.run('DELETE FROM Cart WHERE username = ?', [username], (err) => {
      if (err) {
        console.error('Error clearing cart:', err);
      }
    });

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Successful</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light">
        <div class="container mt-5">
          <div class="card">
            <div class="card-body text-center p-5">
              <h1 class="text-success mb-3">✓ Payment Successful</h1>
              <p class="mb-3">Thank you for your order!</p>
              <p class="text-muted">Order ID: ${session.id}</p>
              <p class="text-muted">Amount: $${(session.amount_total / 100).toFixed(2)} AUD</p>
              <hr>
              <a href="/" class="btn btn-primary me-2">Home</a>
              <a href="/DProject_ProductList" class="btn btn-secondary">Continue Shopping</a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Error retrieving session:', err);
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Status</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light">
        <div class="container mt-5">
          <div class="alert alert-warning">
            <h4>Payment Status Unknown</h4>
            <p>We couldn't verify your payment status. Please check your email for confirmation or contact support.</p>
            <a href="/" class="btn btn-primary">Return to Home</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }
});

// Payment Cancel Page
app.get('/payment-cancel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Cancelled</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body class="bg-light">
      <div class="container mt-5">
        <div class="card">
          <div class="card-body text-center p-5">
            <h1 class="text-danger mb-3">✕ Payment Cancelled</h1>
            <p class="mb-3">Your payment was cancelled. No charges were made.</p>
            <p class="text-muted">Your cart items are still saved.</p>
            <hr>
            <a href="/DProject_Checkout" class="btn btn-primary me-2">Return to Checkout</a>
            <a href="/DProject_Cart" class="btn btn-secondary">View Cart</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});


// Start server
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

module.exports = app;
