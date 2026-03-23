use anchor_lang::prelude::*;

#[error_code]
pub enum InterKnotError {
    #[msg("Commission is not in Open status")]
    CommissionNotOpen,
    #[msg("Commission is not in Matched status")]
    CommissionNotMatched,
    #[msg("Bid price exceeds maximum price")]
    BidPriceTooHigh,
    #[msg("Bidding deadline has passed")]
    DeadlinePassed,
    #[msg("Deadline must be in the future")]
    DeadlineNotFuture,
    #[msg("Only the delegator can perform this action")]
    UnauthorizedDelegator,
    #[msg("Only the executor can perform this action")]
    UnauthorizedExecutor,
    #[msg("Cannot bid on your own commission")]
    SelfBidNotAllowed,
    #[msg("Bid is not in Active status")]
    BidNotActive,
    #[msg("Task type exceeds maximum length")]
    TaskTypeTooLong,
    #[msg("Task spec URI exceeds maximum length")]
    TaskSpecUriTooLong,
    #[msg("Service endpoint exceeds maximum length")]
    ServiceEndpointTooLong,
    #[msg("Price must be greater than zero")]
    PriceZero,
    #[msg("Commission counter overflow")]
    CommissionCountOverflow,
    #[msg("Bid counter overflow")]
    BidCountOverflow,
    #[msg("Delivery already exists for this commission")]
    DeliveryAlreadyExists,
    #[msg("Delivery is not in Pending status")]
    DeliveryNotPending,
    #[msg("Delivery is not in InputReady status")]
    DeliveryNotInputReady,
    #[msg("CID exceeds maximum length")]
    CidTooLong,
    #[msg("CID must not be empty")]
    CidEmpty,
    #[msg("Executor reputation tier does not meet commission minimum requirement")]
    InsufficientReputation,
}
