export type PostStayReview = { rating?: number; liked?: string; disliked?: string; note?: string };

export function validatePostStayReview(review: PostStayReview): PostStayReview {
  if (review.rating !== undefined && (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5)) {
    throw new Error("Rating must be from 1 to 5");
  }
  if (![review.liked, review.disliked, review.note].some((value) => value?.trim()) && review.rating === undefined) {
    throw new Error("A review needs a rating or a note");
  }
  return review;
}
