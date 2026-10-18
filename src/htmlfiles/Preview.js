// what a rider may see BEFORE accepting: area only, no full address, no phone, no customer name
const previewOf = (d) => ({
    _id: d._id,
    orderId: d.orderId,
    pickupAddress: d.pickupAddress,
    dropArea: {
        city: d.address?.city || "",
        pincode: d.address?.pincode || "",
        landmark: d.address?.landmark || "",
    },
    items: d.items,
    itemCount: (d.items || []).reduce((n, i) => n + i.quantity, 0),
    paymentMethod: d.paymentMethod,
    amountToCollect: d.amountToCollect,
    createdAt: d.createdAt,
});

export { previewOf };