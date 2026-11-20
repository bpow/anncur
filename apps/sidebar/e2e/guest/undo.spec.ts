/** A deletion made in the framed sidebar can be taken back from the top of it. */
import { expect, test } from '@playwright/test';
import { HOST_ORIGIN, PAGE_PATH, injectGuest, seedSession, stubApi } from './harness';

const PAGE_URL = `${HOST_ORIGIN}${PAGE_PATH}`;

test('a deleted annotation can be restored from the undo offer', async ({ context }) => {
  await seedSession(context);
  await stubApi(context, PAGE_URL);
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const sidebar = await injectGuest(page);

  await sidebar.getByRole('button', { name: 'New page note' }).click();
  await sidebar.getByLabel('Comment').fill('A note to bring back');
  await sidebar.getByRole('button', { name: 'Post' }).click();
  const card = sidebar.locator('article.card', { hasText: 'A note to bring back' });
  await card.getByRole('button', { name: 'Delete' }).click();
  await sidebar
    .getByRole('alertdialog', { name: 'Delete this annotation?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(card).toHaveCount(0);

  const offer = sidebar.getByRole('region', { name: 'Recent deletions' });
  await expect(offer).toContainText('Deleted an annotation.');
  await offer.getByRole('button', { name: 'Undo' }).click();
  await expect(card).toHaveCount(1);
  await expect(offer).toHaveCount(0);
});
