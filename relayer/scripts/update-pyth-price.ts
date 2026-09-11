import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { HermesClient } from '@pythnetwork/hermes-client';

// Load environment variables from crossvault root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PYTH_CONTRACT_SEPOLIA = '0xBb86bCc951A62DF86826219d9251Ee05F2c1e286';
const ETH_USD_FEED_ID = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

const IPYTH_ABI = [
  'function getUpdateFee(bytes[] calldata updateData) view returns (uint256 feeWei)',
  'function updatePriceFeeds(bytes[] calldata updateData) payable',
  'function getPriceUnsafe(bytes32 id) view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))',
  'event PriceFeedUpdate(bytes32 indexed id, uint64 publishTime, int64 price, uint64 conf)',
];

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error('SEPOLIA_PRIVATE_KEY missing in environment / .env');
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const pythContract = new ethers.Contract(PYTH_CONTRACT_SEPOLIA, IPYTH_ABI, signer);

  console.log(`[Pyth] Initializing official HermesClient with Douro Labs endpoint...`);
  const hermes = new HermesClient("https://pyth.dourolabs.app/hermes", { accessToken: process.env.PYTH_API_KEY });

  console.log(`[Pyth] Fetching latest price update for feed ${ETH_USD_FEED_ID}...`);

  let updateData: string[] = [];

  try {
    const priceUpdates = await hermes.getLatestPriceUpdates([ETH_USD_FEED_ID], { parsed: true });
    if (priceUpdates?.binary?.data) {
      updateData = priceUpdates.binary.data.map((d: string) => (d.startsWith('0x') ? d : '0x' + d));
      console.log(`[Pyth] Successfully fetched ${updateData.length} update payload(s) via HermesClient.`);
    }

    if (priceUpdates?.parsed && priceUpdates.parsed.length > 0) {
      const parsedUpdate = priceUpdates.parsed[0];
      console.log(`[Pyth] Hermes parsed price: ${parsedUpdate.price.price} (expo: ${parsedUpdate.price.expo})`);
    }
  } catch (err: any) {
    console.warn(`[Pyth] HermesClient fetch failed: ${err.message || err}`);
    if (err?.message?.includes('401') || err?.message?.includes('unauthorized')) {
      console.warn(
        `[Pyth] NOTE: Pyth Hermes requires a valid PYTH_API_KEY from Pyth Terminal at https://pythdata.app/signup.`
      );
    }
  }

  if (updateData.length > 0) {
    console.log(`[Pyth] Querying update fee on Sepolia...`);
    const fee = await pythContract.getUpdateFee(updateData);
    console.log(`[Pyth] Update fee: ${fee.toString()} wei. Submitting updatePriceFeeds transaction...`);

    const tx = await pythContract.updatePriceFeeds(updateData, { value: fee });
    console.log(`[Pyth] Tx broadcast: ${tx.hash}. Waiting for confirmation...`);
    const receipt = await tx.wait();
    console.log(`[Pyth] Tx confirmed in block ${receipt.blockNumber}! Gas used: ${receipt.gasUsed.toString()}`);

    // Parse logs for PriceFeedUpdate
    for (const log of receipt.logs) {
      try {
        const parsed = pythContract.interface.parseLog(log);
        if (parsed && parsed.name === 'PriceFeedUpdate') {
          console.log(`[Pyth] Event PriceFeedUpdate: id=${parsed.args.id} price=${parsed.args.price} expo=${parsed.args.expo || 'N/A'}`);
        }
      } catch {}
    }
  }

  // Verify exact current price and exponent on live Sepolia
  console.log(`[Pyth] Calling getPriceUnsafe on live Sepolia contract ${PYTH_CONTRACT_SEPOLIA}...`);
  const priceData = await pythContract.getPriceUnsafe(ETH_USD_FEED_ID);
  console.log(`[Pyth] Live on-chain feed state:`);
  console.log(`  Feed ID:      ${ETH_USD_FEED_ID}`);
  console.log(`  Raw Price:    ${priceData.price.toString()}`);
  console.log(`  Confidence:   ${priceData.conf.toString()}`);
  console.log(`  Exponent:     ${priceData.expo.toString()}`);
  console.log(`  Publish Time: ${new Date(Number(priceData.publishTime) * 1000).toISOString()}`);

  const normalized = Number(priceData.price) * Math.pow(10, 18 + Number(priceData.expo));
  console.log(`  Normalized:   $${(Number(priceData.price) * Math.pow(10, Number(priceData.expo))).toFixed(2)} USD (18-decimal: ${ethers.parseUnits((Number(priceData.price) * Math.pow(10, Number(priceData.expo))).toFixed(2), 18)})`);
}

main().catch((err) => {
  console.error('[Pyth] Script error:', err);
  process.exit(1);
});
