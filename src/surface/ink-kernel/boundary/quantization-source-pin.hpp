#ifndef SHOWAI_BOUNDARY_QUANTIZATION_SOURCE_PIN_HPP
#define SHOWAI_BOUNDARY_QUANTIZATION_SOURCE_PIN_HPP
#include "owner.hpp"
namespace showai_boundary {
// Internal serial-owner lifetime binding. The host must keep the state and its
// backing arena allocated while any lease is retained, as for the public API.
// These pins use the actual source-owner reference count, so destroy cannot
// succeed merely because the host released its original source lease. All math
// records in a derived snapshot must be destroyed BEFORE its final source pin.
// A raw lease is never a cross-WASM-instance or cross-state capability.
class BoundaryQuantizationSourcePin {
    Pointer<Owner>owner_;SABoundaryLease lease_{};
    void drop(){if(owner_){owner_->drop(lease_.slot);owner_=nullptr;lease_={};}}
    bool retain(const BoundaryQuantizationSourcePin&other){
        if(!other.owner_)return true;
        if(!other.owner_->valid(other.lease_)){other.owner_->math.numbers.fail(SA_INK_INVALID);return false;}
        auto&slot=other.owner_->slots[other.lease_.slot];
        if(slot.references==0xffffffffu){other.owner_->math.numbers.fail(SA_INK_CAPACITY);return false;}
        ++slot.references;owner_=other.owner_;lease_=other.lease_;return true;
    }
public:
    BoundaryQuantizationSourcePin()=default;
    BoundaryQuantizationSourcePin(const BoundaryQuantizationSourcePin&other){retain(other);}
    BoundaryQuantizationSourcePin(BoundaryQuantizationSourcePin&&other)noexcept:owner_(other.owner_),lease_(other.lease_){other.owner_=nullptr;other.lease_={};}
    BoundaryQuantizationSourcePin&operator=(const BoundaryQuantizationSourcePin&other){
        if(this!=&other){BoundaryQuantizationSourcePin next;if(!next.retain(other))return*this;*this=static_cast<BoundaryQuantizationSourcePin&&>(next);}return*this;
    }
    BoundaryQuantizationSourcePin&operator=(BoundaryQuantizationSourcePin&&other)noexcept{
        if(this!=&other){drop();owner_=other.owner_;lease_=other.lease_;other.owner_=nullptr;other.lease_={};}return*this;
    }
    ~BoundaryQuantizationSourcePin(){drop();}
    static uint32_t capture(void*state,SABoundaryLease lease,BoundaryQuantizationSourcePin&output){
        auto*actual=showai_boundary::owner(state);
        if(!actual||actual->busy||!actual->valid(lease))return SA_INK_INVALID;
        auto&slot=actual->slots[lease.slot];if(slot.references==0xffffffffu)return SA_INK_CAPACITY;
        BoundaryQuantizationSourcePin staged;++slot.references;staged.owner_=actual;staged.lease_=lease;
        output=static_cast<BoundaryQuantizationSourcePin&&>(staged);return SA_INK_OK;
    }
    bool valid()const{return owner_&&owner_->valid(lease_);}
    const OwnedSnapshot*get()const{return valid()?static_cast<const Owner*>(owner_)->slots[lease_.slot].snapshot.get():nullptr;}
    SABoundaryLease source()const{return lease_;}
    const Owner*domain()const{return owner_;}
    void reset(){drop();}
};
}
#endif
