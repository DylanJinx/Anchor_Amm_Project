# Anchor测试框架完整指南

## 1. 测试框架基础结构

### 1.1 标准测试文件结构

```typescript
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { expect } from 'chai';
import { MyAmmProject } from '../target/types/my_amm_project';

describe('测试套件名称', () => {
  // 1. 配置provider和程序
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  anchor.setProvider(provider);

  const program = anchor.workspace.MyAmmProject as Program<MyAmmProject>;

  // 2. 测试数据变量
  let testData: any;

  // 3. 生命周期钩子
  beforeEach(() => {
    // 每个测试前执行
  });

  // 4. 具体测试用例
  it('测试用例描述', async () => {
    // 测试逻辑
  });
});
```

### 1.2 生命周期钩子选择

| 钩子 | 用途 | 何时使用 |
|------|------|----------|
| `beforeEach` | 每个测试前执行 | ✅ **推荐** - 确保测试独立性 |
| `beforeAll` | 整个套件前执行一次 | ❌ 避免 - 测试间可能相互影响 |
| `afterEach` | 每个测试后执行 | 清理资源时使用 |
| `afterAll` | 整个套件后执行一次 | 清理全局资源 |

**为什么使用beforeEach？**
- 每个测试都有全新的账户和密钥
- 避免测试间的状态污染
- 更容易调试单个测试

## 2. 核心组件详解

### 2.1 Provider配置

```typescript
// 1. 获取环境配置的provider
const provider = anchor.AnchorProvider.env();

// 2. 获取connection对象
const connection = provider.connection;

// 3. 设置全局provider
anchor.setProvider(provider);
```

**Provider包含什么？**
- **Connection**: 与Solana集群的连接
- **Wallet**: 默认签名者（通常是payer）
- **网络配置**: RPC URL、确认级别等

### 2.2 程序对象获取

```typescript
// 从workspace获取编译后的程序
const program = anchor.workspace.MyAmmProject as Program<MyAmmProject>;
```

**Program对象提供什么？**
- `program.methods`: 调用程序指令
- `program.account`: 获取程序账户数据
- `program.programId`: 程序ID

### 2.3 断言库选择

```typescript
import { expect } from 'chai';

// Chai风格（推荐）
expect(actual).to.equal(expected);
expect(account.fee).to.equal(500);

// Node.js assert（也可以）
import { strict as assert } from 'assert';
assert.equal(actual, expected);
```

## 3. 测试数据管理

### 3.1 创建测试工具文件

创建 `tests/utils.ts`：

```typescript
import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';

// 测试数据接口
export interface TestValues {
  id: PublicKey;
  fee: number;
  admin: Keypair;
  ammPda: PublicKey;
  payer: Keypair;
}

// 生成测试数据
export function createTestValues(): TestValues {
  const id = Keypair.generate().publicKey;
  const admin = Keypair.generate();
  const payer = Keypair.generate();
  
  // 计算AMM的PDA地址
  const [ammPda] = PublicKey.findProgramAddressSync(
    [id.toBuffer()],
    anchor.workspace.MyAmmProject.programId
  );

  return {
    id,
    fee: 500, // 5% fee
    admin,
    ammPda,
    payer,
  };
}

// 错误测试工具
export const expectRevert = async (promise: Promise<any>) => {
  try {
    await promise;
    throw new Error('Expected a revert');
  } catch (error: any) {
    // 如果是预期的revert，函数正常返回
    // 如果是我们抛出的错误，会重新抛出
    if (error.message === 'Expected a revert') {
      throw error;
    }
    return; // 预期的错误，测试通过
  }
};
```

### 3.2 PDA地址计算

```typescript
// 根据seeds计算PDA
const [pdaAddress, bump] = PublicKey.findProgramAddressSync(
  [
    seed1.toBuffer(),        // 第一个种子
    seed2.toBuffer(),        // 第二个种子
    Buffer.from('literal')   // 字符串种子
  ],
  programId
);
```

**重要：seeds必须与Rust代码完全一致！**

## 4. 完整测试示例

### 4.1 基础测试结构

```typescript
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { expect } from 'chai';
import { MyAmmProject } from '../target/types/my_amm_project';
import { createTestValues, expectRevert, TestValues } from './utils';

describe('CreateAmm Tests', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MyAmmProject as Program<MyAmmProject>;
  
  let values: TestValues;

  beforeEach(() => {
    values = createTestValues();
  });

  it('应该成功创建AMM', async () => {
    // 1. 调用指令
    await program.methods
      .createAmm(values.id, values.fee)
      .accounts({
        amm: values.ammPda,
        admin: values.admin.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // 2. 验证结果
    const ammAccount = await program.account.amm.fetch(values.ammPda);
    expect(ammAccount.id.toString()).to.equal(values.id.toString());
    expect(ammAccount.admin.toString()).to.equal(values.admin.publicKey.toString());
    expect(ammAccount.fee).to.equal(values.fee);
  });

  it('应该拒绝无效的fee', async () => {
    values.fee = 10000; // 超过100%

    await expectRevert(
      program.methods
        .createAmm(values.id, values.fee)
        .accounts({
          amm: values.ammPda,
          admin: values.admin.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc()
    );
  });
});
```

## 5. 常见测试模式

### 5.1 成功路径测试

```typescript
it('正常功能测试', async () => {
  // 1. 准备数据
  // 2. 执行操作
  // 3. 验证结果
  // 4. 验证状态变化
});
```

### 5.2 错误路径测试

```typescript
it('错误情况测试', async () => {
  // 1. 准备错误数据
  // 2. 期望操作失败
  await expectRevert(operation);
});
```

### 5.3 边界条件测试

```typescript
it('边界值测试', async () => {
  // 测试边界值：0, 9999, 10000等
});
```

## 6. 最佳实践

### 6.1 测试组织
- 每个指令一个测试文件
- 相关测试放在同一个describe块
- 使用描述性的测试名称

### 6.2 数据管理
- 使用beforeEach确保测试独立
- 工具函数放在utils文件
- 避免硬编码的测试数据

### 6.3 断言策略
- 验证所有重要字段
- 使用meaningful的错误信息
- 测试正常和异常情况

### 6.4 调试技巧
```typescript
// 打印账户数据
console.log('Account data:', ammAccount);

// 打印交易签名
const tx = await program.methods.createAmm(...).rpc();
console.log('Transaction:', tx);

// 使用日志
.rpc({ skipPreflight: true }); // 跳过预检查看详细错误
```

## 7. 运行测试

```bash
# 运行所有测试
anchor test

# 运行特定测试文件
npx mocha -t 1000000 tests/create-amm.ts

# 跳过本地验证器（如果已运行）
anchor test --skip-local-validator --skip-deploy
```