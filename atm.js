#!/usr/bin/env node

const { Command } = require('commander');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'atm_simulator'
};

let currentUser = null;

async function createConnection() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        return connection;
    } catch (error) {
        console.log('❌ Error connecting to database:', error.message);
        process.exit(1);
    }
}

async function setupDatabase() {
    const connection = await createConnection();
    
    try {
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS accounts (
                account_number VARCHAR(10) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                pin_hash VARCHAR(255) NOT NULL,
                balance DECIMAL(15,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                account_number VARCHAR(10),
                type ENUM('deposit', 'withdrawal', 'transfer_in', 'transfer_out'),
                amount DECIMAL(15,2),
                target_account VARCHAR(10) NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (account_number) REFERENCES accounts(account_number)
            )
        `);

        console.log('✅ Database setup completed');
    } catch (error) {
        console.log('❌ Error setting up database:', error.message);
    } finally {
        await connection.end();
    }
}

function generateAccountNumber() {
    return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

function getHiddenInput(prompt) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer);
        });

        // Hide input
        rl._writeToOutput = function _writeToOutput(stringToWrite) {
            if (stringToWrite.charCodeAt(0) === 13) {
                rl.output.write('\n');
            } else {
                rl.output.write('*');
            }
        };
    });
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR'
    }).format(amount);
}

// Command: Register
async function registerAccount(name) {
    if (!name) {
        console.log('❌ Nama harus diisi!');
        return;
    }

    try {
        const pin = await getHiddenInput('Masukkan PIN (6 digit): ');
        
        if (!/^\d{6}$/.test(pin)) {
            console.log('❌ PIN harus 6 digit angka!');
            return;
        }

        const confirmPin = await getHiddenInput('Konfirmasi PIN: ');
        
        if (pin !== confirmPin) {
            console.log('❌ PIN tidak cocok!');
            return;
        }

        const connection = await createConnection();
        const accountNumber = generateAccountNumber();
        const hashedPin = await bcrypt.hash(pin, 10);

        await connection.execute(
            'INSERT INTO accounts (account_number, name, pin_hash) VALUES (?, ?, ?)',
            [accountNumber, name, hashedPin]
        );

        console.log('\n✅ Akun berhasil dibuat!');
        console.log(`📋 Nomor Akun: ${accountNumber}`);
        console.log(`👤 Nama: ${name}`);
        console.log('💡 Simpan nomor akun Anda dengan aman!\n');

        await connection.end();
    } catch (error) {
        console.log('❌ Error creating account:', error.message);
    }
}

// Command: Login
async function loginAccount(accountNumber) {
    if (!accountNumber) {
        console.log('❌ Nomor akun harus diisi!');
        return;
    }

    try {
        const connection = await createConnection();
        
        const [rows] = await connection.execute(
            'SELECT * FROM accounts WHERE account_number = ?',
            [accountNumber]
        );

        if (rows.length === 0) {
            console.log('❌ Nomor akun tidak ditemukan!');
            await connection.end();
            return;
        }

        const pin = await getHiddenInput('Masukkan PIN: ');
        const account = rows[0];
        
        const isValidPin = await bcrypt.compare(pin, account.pin_hash);
        
        if (!isValidPin) {
            console.log('❌ PIN salah!');
            await connection.end();
            return;
        }

        currentUser = {
            accountNumber: account.account_number,
            name: account.name,
            balance: parseFloat(account.balance)
        };

        console.log('\n✅ Login berhasil!');
        console.log(`👤 Selamat datang, ${currentUser.name}`);
        console.log(`💰 Saldo: ${formatCurrency(currentUser.balance)}\n`);

        await connection.end();
    } catch (error) {
        console.log('❌ Error during login:', error.message);
    }
}

// Command: Check Balance
async function checkBalance() {
    if (!currentUser) {
        console.log('❌ Anda harus login terlebih dahulu!');
        return;
    }

    try {
        const connection = await createConnection();
        
        const [rows] = await connection.execute(
            'SELECT balance FROM accounts WHERE account_number = ?',
            [currentUser.accountNumber]
        );

        if (rows.length > 0) {
            const balance = parseFloat(rows[0].balance);
            currentUser.balance = balance;
            
            console.log('\n💰 INFORMASI SALDO');
            console.log('===================');
            console.log(`👤 Nama: ${currentUser.name}`);
            console.log(`📋 No. Akun: ${currentUser.accountNumber}`);
            console.log(`💵 Saldo: ${formatCurrency(balance)}\n`);
        }

        await connection.end();
    } catch (error) {
        console.log('❌ Error checking balance:', error.message);
    }
}

// Command: Deposit
async function deposit(amount) {
    if (!currentUser) {
        console.log('❌ Anda harus login terlebih dahulu!');
        return;
    }

    const depositAmount = parseFloat(amount);
    
    if (isNaN(depositAmount) || depositAmount <= 0) {
        console.log('❌ Jumlah deposit harus berupa angka positif!');
        return;
    }

    if (depositAmount < 10000) {
        console.log('❌ Minimum deposit Rp 10.000!');
        return;
    }

    try {
        const connection = await createConnection();
        
        // Update saldo
        await connection.execute(
            'UPDATE accounts SET balance = balance + ? WHERE account_number = ?',
            [depositAmount, currentUser.accountNumber]
        );

        // Catat transaksi
        await connection.execute(
            'INSERT INTO transactions (account_number, type, amount, description) VALUES (?, ?, ?, ?)',
            [currentUser.accountNumber, 'deposit', depositAmount, `Setor tunai ${formatCurrency(depositAmount)}`]
        );

        currentUser.balance += depositAmount;

        console.log('\n✅ SETOR TUNAI BERHASIL');
        console.log('========================');
        console.log(`💵 Jumlah Setor: ${formatCurrency(depositAmount)}`);
        console.log(`💰 Saldo Akhir: ${formatCurrency(currentUser.balance)}`);
        console.log(`📅 Tanggal: ${new Date().toLocaleString('id-ID')}\n`);

        await connection.end();
    } catch (error) {
        console.log('❌ Error during deposit:', error.message);
    }
}

// Command: Withdraw
async function withdraw(amount) {
    if (!currentUser) {
        console.log('❌ Anda harus login terlebih dahulu!');
        return;
    }

    const withdrawAmount = parseFloat(amount);
    
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
        console.log('❌ Jumlah penarikan harus berupa angka positif!');
        return;
    }

    if (withdrawAmount < 50000) {
        console.log('❌ Minimum penarikan Rp 50.000!');
        return;
    }

    if (withdrawAmount % 50000 !== 0) {
        console.log('❌ Jumlah penarikan harus kelipatan Rp 50.000!');
        return;
    }

    try {
        const connection = await createConnection();
        
        const [rows] = await connection.execute(
            'SELECT balance FROM accounts WHERE account_number = ?',
            [currentUser.accountNumber]
        );

        const currentBalance = parseFloat(rows[0].balance);
        
        if (currentBalance < withdrawAmount) {
            console.log('❌ Saldo tidak mencukupi!');
            console.log(`💰 Saldo Anda: ${formatCurrency(currentBalance)}`);
            await connection.end();
            return;
        }

        await connection.execute(
            'UPDATE accounts SET balance = balance - ? WHERE account_number = ?',
            [withdrawAmount, currentUser.accountNumber]
        );

        await connection.execute(
            'INSERT INTO transactions (account_number, type, amount, description) VALUES (?, ?, ?, ?)',
            [currentUser.accountNumber, 'withdrawal', withdrawAmount, `Tarik tunai ${formatCurrency(withdrawAmount)}`]
        );

        currentUser.balance = currentBalance - withdrawAmount;

        console.log('\n✅ TARIK TUNAI BERHASIL');
        console.log('========================');
        console.log(`💵 Jumlah Tarik: ${formatCurrency(withdrawAmount)}`);
        console.log(`💰 Saldo Akhir: ${formatCurrency(currentUser.balance)}`);
        console.log(`📅 Tanggal: ${new Date().toLocaleString('id-ID')}\n`);

        await connection.end();
    } catch (error) {
        console.log('❌ Error during withdrawal:', error.message);
    }
}

// Command: Transfer
async function transfer(targetAccount, amount) {
    if (!currentUser) {
        console.log('❌ Anda harus login terlebih dahulu!');
        return;
    }

    if (!targetAccount || !amount) {
        console.log('❌ Nomor akun tujuan dan jumlah transfer harus diisi!');
        return;
    }

    const transferAmount = parseFloat(amount);
    
    if (isNaN(transferAmount) || transferAmount <= 0) {
        console.log('❌ Jumlah transfer harus berupa angka positif!');
        return;
    }

    if (transferAmount < 10000) {
        console.log('❌ Minimum transfer Rp 10.000!');
        return;
    }

    if (targetAccount === currentUser.accountNumber) {
        console.log('❌ Tidak dapat transfer ke akun sendiri!');
        return;
    }

    try {
        const connection = await createConnection();
        
        const [targetRows] = await connection.execute(
            'SELECT name FROM accounts WHERE account_number = ?',
            [targetAccount]
        );

        if (targetRows.length === 0) {
            console.log('❌ Akun tujuan tidak ditemukan!');
            await connection.end();
            return;
        }

        const [senderRows] = await connection.execute(
            'SELECT balance FROM accounts WHERE account_number = ?',
            [currentUser.accountNumber]
        );

        const currentBalance = parseFloat(senderRows[0].balance);
        
        if (currentBalance < transferAmount) {
            console.log('❌ Saldo tidak mencukupi!');
            console.log(`💰 Saldo Anda: ${formatCurrency(currentBalance)}`);
            await connection.end();
            return;
        }

        await connection.beginTransaction();

        try {
            // Kurangi saldo pengirim
            await connection.execute(
                'UPDATE accounts SET balance = balance - ? WHERE account_number = ?',
                [transferAmount, currentUser.accountNumber]
            );

            // Tambah saldo penerima
            await connection.execute(
                'UPDATE accounts SET balance = balance + ? WHERE account_number = ?',
                [transferAmount, targetAccount]
            );

            // Catat transaksi pengirim
            await connection.execute(
                'INSERT INTO transactions (account_number, type, amount, target_account, description) VALUES (?, ?, ?, ?, ?)',
                [currentUser.accountNumber, 'transfer_out', transferAmount, targetAccount, `Transfer ke ${targetAccount} - ${targetRows[0].name}`]
            );

            // Catat transaksi penerima
            await connection.execute(
                'INSERT INTO transactions (account_number, type, amount, target_account, description) VALUES (?, ?, ?, ?, ?)',
                [targetAccount, 'transfer_in', transferAmount, currentUser.accountNumber, `Transfer dari ${currentUser.accountNumber} - ${currentUser.name}`]
            );

            await connection.commit();

            // Update current user balance
            currentUser.balance = currentBalance - transferAmount;

            console.log('\n✅ TRANSFER BERHASIL');
            console.log('====================');
            console.log(`📤 Dari: ${currentUser.name} (${currentUser.accountNumber})`);
            console.log(`📥 Ke: ${targetRows[0].name} (${targetAccount})`);
            console.log(`💵 Jumlah: ${formatCurrency(transferAmount)}`);
            console.log(`💰 Saldo Akhir: ${formatCurrency(currentUser.balance)}`);
            console.log(`📅 Tanggal: ${new Date().toLocaleString('id-ID')}\n`);

        } catch (error) {
            await connection.rollback();
            throw error;
        }

        await connection.end();
    } catch (error) {
        console.log('❌ Error during transfer:', error.message);
    }
}

// Command: Transaction History
async function showHistory() {
    if (!currentUser) {
        console.log('❌ Anda harus login terlebih dahulu!');
        return;
    }

    try {
        const connection = await createConnection();
        
        const [rows] = await connection.execute(`
            SELECT type, amount, target_account, description, created_at 
            FROM transactions 
            WHERE account_number = ? 
            ORDER BY created_at DESC 
            LIMIT 10
        `, [currentUser.accountNumber]);

        if (rows.length === 0) {
            console.log('\n📝 Belum ada riwayat transaksi\n');
            await connection.end();
            return;
        }

        console.log('\n📝 RIWAYAT TRANSAKSI (10 Terakhir)');
        console.log('====================================');
        
        rows.forEach((row, index) => {
            const date = new Date(row.created_at).toLocaleString('id-ID');
            const amount = formatCurrency(row.amount);
            
            let typeIcon = '';
            switch (row.type) {
                case 'deposit': typeIcon = '📥'; break;
                case 'withdrawal': typeIcon = '📤'; break;
                case 'transfer_out': typeIcon = '↗️'; break;
                case 'transfer_in': typeIcon = '↙️'; break;
            }
            
            console.log(`${index + 1}. ${typeIcon} ${row.description}`);
            console.log(`   💵 ${amount} | 📅 ${date}`);
            console.log('');
        });

        await connection.end();
    } catch (error) {
        console.log('❌ Error fetching transaction history:', error.message);
    }
}

// Command: Logout
function logout() {
    if (!currentUser) {
        console.log('❌ Anda belum login!');
        return;
    }

    console.log(`👋 Sampai jumpa, ${currentUser.name}!`);
    currentUser = null;
    console.log('✅ Logout berhasil\n');
}

const program = new Command();

program
    .name('atm')
    .description('ATM Simulator CLI Application')
    .version('1.0.0');

program
    .command('setup')
    .description('Setup database dan tabel')
    .action(setupDatabase);

program
    .command('register')
    .description('Registrasi akun baru')
    .argument('<name>', 'Nama pemilik akun')
    .action(registerAccount);

program
    .command('login')
    .description('Login ke akun')
    .argument('<accountNumber>', 'Nomor akun')
    .action(loginAccount);

program
    .command('balance')
    .description('Cek saldo akun')
    .action(checkBalance);

program
    .command('deposit')
    .description('Setor tunai')
    .argument('<amount>', 'Jumlah deposit')
    .action(deposit);

program
    .command('withdraw')
    .description('Tarik tunai')
    .argument('<amount>', 'Jumlah penarikan')
    .action(withdraw);

program
    .command('transfer')
    .description('Transfer antar akun')
    .argument('<targetAccount>', 'Nomor akun tujuan')
    .argument('<amount>', 'Jumlah transfer')
    .action(transfer);

program
    .command('history')
    .description('Riwayat transaksi')
    .action(showHistory);

program
    .command('logout')
    .description('Logout dari akun')
    .action(logout);

program
    .command('status')
    .description('Status login saat ini')
    .action(() => {
        if (currentUser) {
            console.log(`✅ Login sebagai: ${currentUser.name} (${currentUser.accountNumber})`);
            console.log(`💰 Saldo: ${formatCurrency(currentUser.balance)}`);
        } else {
            console.log('❌ Belum login');
        }
    });

// Parse command line arguments
program.parse();