const mysql = require('mysql2/promise'); // 启用 Promise 版本

// 1. 创建连接池
const pool = mysql.createPool({
  host: '115.190.196.175',
  port: 3306,
  user: 'yykjzhc',
  password: 'yuanyekeji$DSZ',
  database: 'dev',
  waitForConnections: true, // 无可用连接时等待
  connectionLimit: 100,      // 最大连接数
  queueLimit: 0             // 等待队列无限制
});

// 2. 异步查询（async/await 语法，更易维护）
async function queryUsers() {
  try {
    // 获取连接 + 执行查询（一步到位）
    const [rows, fields] = await pool.execute(
      'SELECT * FROM user_core_stats ORDER BY points DESC', // SQL 语句
      [] // 占位符参数（无则传空数组）
    );
    console.log('用户列表（按 points 降序）：', rows);
    return rows;
  } catch (err) {
    console.error('查询异常：', err);
    throw err;
  }
}

// 调用查询函数
queryUsers();