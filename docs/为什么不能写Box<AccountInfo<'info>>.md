🤔 问题 1：为什么 AccountInfo 不能用 Box？

AccountInfo vs Account 的内存结构差异

AccountInfo 很小：

```rust
pub struct AccountInfo<'a> {
pub key: &'a Pubkey, // 8 字节指针
pub lamports: Rc<RefCell<&'a mut u64>>, // 很小的引用
pub data: Rc<RefCell<&'a mut [u8]>>, //
指针，不是数据本身
pub owner: &'a Pubkey, // 8 字节指针
pub executable: bool, // 1 字节
pub rent_epoch: Epoch, // 8 字节
}
// 总共大约 32-40 字节，非常小！

Account<'info, T>很大：
pub struct Account<'info, T> {
info: AccountInfo<'info>, // 40 字节的 AccountInfo
account: T, // 完整的反序列化数据！
}

// 比如 Account<'info, Mint>:
// - AccountInfo: 40 字节
// - Mint 结构体: 82 字节
 // - 总共: 122 字节+

// CreatePool 有 9 个这样的 Account，栈会溢出！
```

为什么 Box 会报错？

类型系统限制：

```rust
// ✅ Anchor 支持：
pub pool_authority: AccountInfo<'info>,

// ❌ Anchor 不支持：
pub pool_authority: Box<AccountInfo<'info>>,
```

原因：

1. AccountInfo 已经够小 - 不需要 Box 优化
2. Anchor 类型检查 - 框架期望特定的类型签名
3. 编译器约束验证 - #[account()] 宏不支持 Box<AccountInfo>

简单说：AccountInfo 太小了，不需要 Box，而且 Anchor 也不允许！
