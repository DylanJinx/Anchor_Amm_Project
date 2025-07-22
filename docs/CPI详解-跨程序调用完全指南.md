# CPI详解：跨程序调用完全指南

## 什么是CPI？

**CPI = Cross-Program Invocation（跨程序调用）**

CPI是Solana程序调用其他程序的机制。想象你的程序需要调用SPL Token程序来转移代币，就需要使用CPI。

## 核心概念对比

### 与Solidity对比

| 特性 | Solidity | Solana CPI |
|------|----------|------------|
| 调用方式 | `contract.call()` | `CpiContext::new()` |
| 权限检查 | 自动继承调用者权限 | 必须显式传递账户和签名 |
| 数据传递 | 通过函数参数 | 通过账户+指令数据 |
| 错误处理 | try/catch | Result<T, Error> |

```solidity
// Solidity 调用其他合约
IERC20(token).transfer(to, amount);
```

```rust
// Solana CPI 调用
token::transfer(
    CpiContext::new(program, accounts),
    amount
)?;
```

### 与TypeScript客户端调用对比

| 层级 | TypeScript → Program | Program → Program (CPI) |
|------|---------------------|-------------------------|
| 调用者 | 客户端应用 | Solana程序 |
| 被调用者 | Solana程序 | 其他Solana程序 |
| 签名者 | 用户钱包 | 程序PDA |
| 权限验证 | RPC节点 | 运行时 |

```typescript
// TypeScript 调用程序
await program.methods.depositLiquidity(amountA, amountB).accounts({
    pool: poolAddress,
    depositor: wallet.publicKey,
    // ...
}).rpc();
```

```rust
// 程序内 CPI 调用
token::transfer(
    CpiContext::new(
        token_program,
        Transfer { from, to, authority }
    ),
    amount
)?;
```

## CPI的完整结构解析

### 基本语法结构

```rust
目标_程序::指令_函数(
    CpiContext::new(              // CPI 上下文
        目标程序账户,                // 要调用的程序
        指令所需的账户结构 {          // 目标指令需要的所有账户
            账户字段1: 账户1,
            账户字段2: 账户2,
            // ...
        },
    ),
    指令参数1,                     // 目标指令的参数
    指令参数2,
    // ...
)?;                              // 错误处理
```

### 实际例子对比

#### 1. SPL Token Transfer

**TypeScript客户端调用**：
```typescript
// 客户端调用 SPL Token 程序
await splToken.transfer(
    connection,
    payer,           // 支付者
    source,          // 源账户  
    destination,     // 目标账户
    owner,           // 授权者
    amount           // 数量
);
```

**程序内CPI调用**：
```rust
// 程序内调用 SPL Token 程序
token::transfer(
    CpiContext::new(
        ctx.accounts.token_program.to_account_info(),    // SPL Token程序
        Transfer {                                       // Transfer指令需要的账户
            from: ctx.accounts.source.to_account_info(),        // 源账户
            to: ctx.accounts.destination.to_account_info(),     // 目标账户  
            authority: ctx.accounts.owner.to_account_info(),    // 授权者
        },
    ),
    amount,          // 转移数量
)?;
```

#### 2. SPL Token Mint

**TypeScript客户端调用**：
```typescript
await splToken.mintTo(
    connection,
    payer,           // 支付者
    mint,            // mint账户
    destination,     // 目标账户
    authority,       // mint权限
    amount           // 铸造数量
);
```

**程序内CPI调用**：
```rust
token::mint_to(
    CpiContext::new(
        ctx.accounts.token_program.to_account_info(),    // SPL Token程序
        MintTo {                                         // MintTo指令需要的账户
            mint: ctx.accounts.mint.to_account_info(),          // mint账户
            to: ctx.accounts.destination.to_account_info(),     // 目标账户
            authority: ctx.accounts.authority.to_account_info(), // mint权限
        },
    ),
    amount,          // 铸造数量
)?;
```

## 账户参数 vs 指令参数

### 账户参数（Accounts）

**作用**：告诉程序要操作哪些账户

```rust
Transfer {
    from: ctx.accounts.depositor_account_a.to_account_info(),    // 账户参数
    to: ctx.accounts.pool_account_a.to_account_info(),          // 账户参数  
    authority: ctx.accounts.depositor.to_account_info(),        // 账户参数
}
```

### 指令参数（Instruction Data）

**作用**：传递具体的操作数据

```rust
token::transfer(
    CpiContext::new(/*...*/),
    amount_a,        // 指令参数：转移多少代币
)?;

token::mint_to(
    CpiContext::new(/*...*/),
    liquidity,       // 指令参数：铸造多少代币
)?;
```

## 关键区别：CpiContext::new() vs CpiContext::new_with_signer()

这是CPI中最重要的概念之一！理解这个区别是掌握Solana权限模型的关键。

### CpiContext::new() - 普通签名

**使用场景**：当authority是普通账户（用户）时

```rust
// 用户转移自己的代币
token::transfer(
    CpiContext::new(                    // ← 普通CpiContext
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.depositor_account_a.to_account_info(),
            to: ctx.accounts.pool_account_a.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),  // ← 用户账户
        },
    ),
    amount_a,
)?;
```

**权限来源**：
- `depositor`是普通用户账户（有私钥）
- 用户在发起交易时已经签名
- Solana运行时已验证用户签名
- CPI时直接使用已验证的用户权限

### CpiContext::new_with_signer() - PDA签名

**使用场景**：当authority是PDA时

```rust
// 程序代表PDA执行铸造操作
let authority_bump = ctx.bumps.pool_authority;
let authority_seeds = &[
    &ctx.accounts.pool.amm.to_bytes(),
    &ctx.accounts.mint_a.key().to_bytes(),
    &ctx.accounts.mint_b.key().to_bytes(),
    AUTHORITY_SEED,
    &[authority_bump],
];
let signer_seeds = &[&authority_seeds[..]];

token::mint_to(
    CpiContext::new_with_signer(        // ← 带签名的CpiContext
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint: ctx.accounts.mint_liquidity.to_account_info(),
            to: ctx.accounts.depositor_account_liquidity.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),  // ← PDA账户
        },
        signer_seeds,                   // ← 提供PDA签名证明
    ),
    liquidity,
)?;
```

**权限来源**：
- `pool_authority`是PDA（没有私钥）
- PDA无法像普通账户那样签名
- 程序必须证明它有权代表这个PDA行动
- 通过提供正确的seeds来生成"程序签名"

## 深入理解：为什么需要这种区别？

### 权限验证的不同路径

#### 1. 普通账户的权限验证
```
用户发起交易 → 用户私钥签名 → 运行时验证签名 → CPI继承权限 → 操作成功
```

#### 2. PDA的权限验证  
```
程序执行 → 提供PDA seeds → 运行时验证seeds → 生成临时签名 → 操作成功
```

### 具体例子对比

#### transfer操作：用户授权
```rust
// 权限链：用户 → 用户的代币账户
// 用户说："我授权转移我的代币"
token::transfer(
    CpiContext::new(..., Transfer {
        authority: user_account,  // 用户已经签名了
    }),
    amount
)?;
```

#### mint_to操作：程序授权
```rust
// 权限链：程序 → PDA → mint账户
// 程序说："我证明我可以代表这个PDA行动"
token::mint_to(
    CpiContext::new_with_signer(..., MintTo {
        authority: pda_account,  // PDA无法直接签名
    }, pda_seeds),              // 程序提供证明
    amount
)?;
```

## 签名验证的技术细节

### PDA签名的生成过程

```rust
// 1. 程序提供seeds
let seeds = &[b"authority", &amm.to_bytes(), &[bump]];

// 2. 运行时重新计算PDA地址
let computed_pda = find_program_address(seeds, program_id);

// 3. 验证计算出的地址与提供的authority相匹配
assert_eq!(computed_pda, authority_account.key());

// 4. 如果匹配，运行时为这个CPI生成临时签名权限
```

### 安全性保障

**普通签名**：
- ✅ 用户必须拥有私钥
- ✅ 用户必须主动签名授权
- ❌ 用户可能被钓鱼攻击

**PDA签名**：
- ✅ 只有拥有seeds的程序才能签名
- ✅ 程序逻辑控制何时签名
- ✅ 无法被外部私钥控制
- ❌ 程序bug可能导致滥用

## 实际应用场景

### 需要 CpiContext::new() 的场景

1. **用户资产转移**
   ```rust
   // 用户转移自己的代币到池子
   token::transfer(CpiContext::new(...), amount)?;
   ```

2. **用户授权的销毁**
   ```rust  
   // 用户销毁自己的LP代币
   token::burn(CpiContext::new(...), amount)?;
   ```

### 需要 CpiContext::new_with_signer() 的场景

1. **程序代理操作**
   ```rust
   // 程序代表池子向用户铸造LP代币
   token::mint_to(CpiContext::new_with_signer(...), amount)?;
   ```

2. **池子资产管理**
   ```rust
   // 程序代表池子转移代币给用户
   token::transfer(CpiContext::new_with_signer(...), amount)?;
   ```

3. **自动化操作**
   ```rust
   // 程序自动执行某些管理功能
   system_program::create_account(CpiContext::new_with_signer(...));
   ```

## 常见错误和调试

### 错误1：签名类型使用错误
```rust
// ❌ 错误：用户权限却使用了signer
token::transfer(
    CpiContext::new_with_signer(..., signer_seeds),  // 不需要signer
    amount
)?;

// ✅ 正确：用户权限使用普通CpiContext
token::transfer(
    CpiContext::new(...),
    amount
)?;
```

### 错误2：PDA权限但未提供签名
```rust
// ❌ 错误：PDA权限但没有提供seeds
token::mint_to(
    CpiContext::new(..., MintTo {
        authority: pda_account,  // PDA无法直接签名！
    }),
    amount
)?;

// ✅ 正确：PDA权限提供seeds
token::mint_to(
    CpiContext::new_with_signer(..., signer_seeds),
    amount
)?;
```

### 错误3：Seeds不正确
```rust
// ❌ 错误：seeds与创建时不匹配
let wrong_seeds = &[b"wrong_seed", &[bump]];

// ✅ 正确：使用创建PDA时相同的seeds
let correct_seeds = &[b"authority", &amm.to_bytes(), &[bump]];
```

## 调试技巧

1. **检查权限类型**
   ```rust
   msg!("Authority: {}", authority.key());
   msg!("Is PDA: {}", authority.executable);
   ```

2. **验证seeds正确性**
   ```rust
   let (expected_pda, _) = Pubkey::find_program_address(seeds, program_id);
   msg!("Expected PDA: {}", expected_pda);
   msg!("Actual authority: {}", authority.key());
   ```

3. **错误信息分析**
   - `Signature verification failed`：通常是签名类型错误
   - `Invalid seeds`：PDA seeds不正确
   - `Missing required signature`：忘记提供PDA签名

理解这个区别是掌握Solana程序开发的关键！这也是为什么Solana比其他链更安全的原因之一。

## CPI的工作流程

### 1. 准备阶段
```rust
// 1. 确定要调用的程序
let target_program = ctx.accounts.token_program.to_account_info();

// 2. 准备目标指令需要的账户
let accounts = Transfer {
    from: source_account,
    to: dest_account, 
    authority: authority_account,
};

// 3. 准备指令参数
let amount = 1000;
```

### 2. 执行阶段
```rust
// 4. 创建CPI上下文
let cpi_ctx = CpiContext::new(target_program, accounts);

// 5. 调用目标程序
token::transfer(cpi_ctx, amount)?;
```

### 3. 验证阶段
- Solana运行时验证权限
- 检查账户所有权
- 执行目标程序指令
- 返回结果

## 常见的CPI使用场景

### 1. Token操作
```rust
// 转移代币
token::transfer(...)

// 铸造代币  
token::mint_to(...)

// 销毁代币
token::burn(...)
```

### 2. 账户创建
```rust
// 创建系统账户
system_program::create_account(...)

// 创建关联代币账户
associated_token::create(...)
```

### 3. 程序间交互
```rust
// 调用自定义程序
my_program::custom_instruction(...)
```

## 错误处理

### CPI错误的传播
```rust
// CPI调用可能失败
match token::transfer(cpi_ctx, amount) {
    Ok(()) => {
        msg!("转账成功");
    },
    Err(e) => {
        msg!("转账失败: {:?}", e);
        return Err(e);  // 传播错误
    }
}

// 简化写法（推荐）
token::transfer(cpi_ctx, amount)?;  // 自动传播错误
```

### 常见错误类型
1. **账户权限错误**：authority不正确
2. **账户所有权错误**：账户不属于预期程序
3. **余额不足**：转账金额超过可用余额
4. **签名错误**：PDA签名种子不正确

## 安全考虑

### 1. 权限检查
```rust
// 确保只有授权用户才能发起CPI
require!(
    ctx.accounts.depositor.key() == ctx.accounts.token_account.owner,
    ErrorCode::Unauthorized
);
```

### 2. 程序验证
```rust
// 确保调用的是正确的程序
require!(
    ctx.accounts.token_program.key() == spl_token::ID,
    ErrorCode::InvalidProgram
);
```

### 3. 数据验证
```rust
// 验证转账金额合理
require!(
    amount > 0 && amount <= MAX_TRANSFER_AMOUNT,
    ErrorCode::InvalidAmount
);
```

## 与其他区块链的对比总结

| 特性 | Ethereum | Solana CPI | 备注 |
|------|----------|------------|------|
| 调用开销 | Gas费高 | 计算单位消耗少 | Solana更高效 |
| 权限模型 | 隐式继承 | 显式传递 | Solana更安全 |
| 组合性 | 有限 | 强大 | Solana支持复杂交互 |
| 开发复杂度 | 较低 | 较高 | 需要理解账户模型 |

## 实践建议

1. **理解账户流向**：画图理解代币从哪里到哪里
2. **检查权限链条**：确保每个CPI都有正确授权
3. **错误处理**：使用`?`操作符简化错误处理
4. **测试CPI**：重点测试跨程序调用的边界情况
5. **安全审查**：CPI是攻击的常见入口点

CPI是Solana程序设计的核心，掌握了CPI就能理解Solana程序间如何协作和组合！