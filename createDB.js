const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('myHDDB.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Connected to database.');
  }
});

db.serialize(() => {
  // Recreate tables from scratch so Docker build always starts clean
  db.run('DROP TABLE IF EXISTS Cart');
  db.run('DROP TABLE IF EXISTS EmailOTP');
  db.run('DROP TABLE IF EXISTS Feedback');
  db.run('DROP TABLE IF EXISTS Customer');
  db.run('DROP TABLE IF EXISTS Products');
  db.run('DROP TABLE IF EXISTS User');

  db.run(`
    CREATE TABLE User (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE Feedback (
      id INTEGER PRIMARY KEY,
      message TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE Products (
      id INTEGER PRIMARY KEY,
      prd_code TEXT,
      prd_name TEXT,
      prd_stock INTEGER,
      prd_price FLOAT,
      prd_description TEXT,
      prd_image TEXT
    )
  `);

  db.run(`
    CREATE TABLE Customer (
      id INTEGER PRIMARY KEY,
      cus_fname TEXT,
      cus_sname TEXT,
      cus_email TEXT,
      cus_mobile TEXT,
      cus_bdate DATE,
      cus_addr TEXT,
      cus_suburb TEXT,
      cus_state TEXT
    )
  `);

  db.run(`
    CREATE TABLE EmailOTP (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      otp TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      is_used INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE Cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES Products(id),
      FOREIGN KEY (username) REFERENCES User(username)
    )
  `);

  db.run(`
    INSERT INTO User (id, username, password, email)
    VALUES (1, 'administrator', 'Admin1234', 'admin@example.com')
  `);

  db.run(`
    INSERT INTO User (id, username, password, email)
    VALUES (2, 'test', 'test1234', 'test@example.com')
  `);

  db.run(`
    INSERT INTO Feedback (id, message)
    VALUES (1, 'Delivery needs to be quicker')
  `);

  db.run(`
    INSERT INTO Products
    (id, prd_code, prd_name, prd_stock, prd_price, prd_description, prd_image)
    VALUES
    (
      2,
      'SSGLXS25FE',
      'Samsung Galaxy S25 FE',
      89,
      769,
      '4900 mAh battery, 6.7 inch FHD display, up to 120Hz',
      'https://www.amaysim.com.au/content/dam/amaysim/devices/phones/samsung/samsung-galaxy-s25-fe/navy/position_1.jpg'
    )
  `);

  db.run(`
    INSERT INTO Products
    (id, prd_code, prd_name, prd_stock, prd_price, prd_description, prd_image)
    VALUES
    (
      3,
      'IP17PRM',
      'Iphone 17 Promax',
      63,
      2199,
      '48MP camera, A19 Pro Chip, Durable ceramic shield',
      'https://www.jbhifi.com.au/cdn/shop/files/816123-Product-0-I-638930467806479268.jpg?v=1757904187'
    )
  `);

  db.run(`
    INSERT INTO Products
    (id, prd_code, prd_name, prd_stock, prd_price, prd_description, prd_image)
    VALUES
    (
      9,
      'SSGLXA54',
      'Samsung Galaxy A54 5G',
      45,
      629,
      '50MP camera, 6.4 inch FHD display, 6GB RAM',
      'https://www.costco.com.au/medias/sys_master/images/hab/hdf/150888590606366.webp'
    )
  `);

  db.run(`
    INSERT INTO Customer
    (id, cus_fname, cus_sname, cus_email, cus_mobile, cus_bdate, cus_addr, cus_suburb, cus_state)
    VALUES
    (
      1,
      'Mark',
      'Ant',
      'mark.ant@example.com',
      '0224336768',
      '1997-08-08',
      '31 HWS',
      'Burwood',
      'Victoria'
    )
  `);
});

db.close((err) => {
  if (err) {
    console.error('Error closing database:', err.message);
    process.exit(1);
  }

  console.log('Database initialised successfully.');
});