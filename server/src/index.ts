import { PORTS } from '@llmrpg/shared';
import { createApp } from './app';
import { registerWithSkillShop } from './skillshop/registration';

const port = Number(process.env.LLMRPG_PORT) || PORTS.LLMRPG_SERVER;

const app = createApp();

app.listen(port, () => {
  console.log(`llmrpg-server listening on :${port}`);
  void registerWithSkillShop();
});
