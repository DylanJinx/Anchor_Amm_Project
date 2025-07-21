admin（人类管理员）

// admin 是人类用户：
admin: Keypair // 需要私钥，人类控制

- 作用：AMM 的人类管理员
- 用途：修改费率、暂停交易等管理操作
- 签名：需要人类提供私钥签名

poolAuthority（程序权限账户）

// poolAuthority 是程序的机器人：
poolAuthority: PublicKey // PDA 地址，程序控制

- 作用：程序的"机器人账户"
- 用途：代表程序管理代币转移
- 签名：程序自动签名，不需要人类介入

类比理解：

// 银行系统类比：
admin = 银行行长 // 人类，做重大决策
poolAuthority = ATM 机器 // 机器，自动处理日常转账

// 用户存款时：
// 1. 用户 → poolAuthority（ATM 自动收钱）
// 2. poolAuthority → pool_account_a（ATM 存到金库）
// 3. admin 不参与日常转账！
