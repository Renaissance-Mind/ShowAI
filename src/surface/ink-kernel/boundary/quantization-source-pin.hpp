#ifndef SHOWAI_BOUNDARY_QUANTIZATION_SOURCE_PIN_HPP
#define SHOWAI_BOUNDARY_QUANTIZATION_SOURCE_PIN_HPP
#include "owner.hpp"
namespace showai_boundary {
class BoundaryQuantizationSourcePin {
    Pointer<Owner>owner_;SABoundaryLease lease_{};
    static LeaseSlot&slot(Owner&owner,uint32_t index){return owner.edit_slot(index);}
    void drop(){if(owner_){owner_->drop(lease_.slot);owner_=nullptr;lease_={};}}
    bool retain(const BoundaryQuantizationSourcePin&other){
        if(!other.owner_)return true;
        if(!other.owner_->valid(other.lease_)){other.owner_->math.numbers.fail(SA_INK_INVALID);return false;}
        auto&slot=BoundaryQuantizationSourcePin::slot(*other.owner_,other.lease_.slot);
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
        auto&slot=BoundaryQuantizationSourcePin::slot(*actual,lease.slot);if(slot.references==0xffffffffu)return SA_INK_CAPACITY;
        BoundaryQuantizationSourcePin staged;++slot.references;staged.owner_=actual;staged.lease_=lease;
        output=static_cast<BoundaryQuantizationSourcePin&&>(staged);return SA_INK_OK;
    }
    bool valid()const{return owner_&&owner_->valid(lease_);}
    const OwnedSnapshot*get()const{return valid()?static_cast<const Owner*>(owner_)->slots[lease_.slot].snapshot.get():nullptr;}
    SABoundaryLease source()const{return lease_;}
    bool latest()const{return valid()&&owner_->current==lease_.slot;}
    bool same_snapshot(const BoundaryQuantizationSourcePin&other)const{
        return valid()&&other.valid()&&domain()==other.domain()&&get()==other.get();
    }
    bool base_of(const BoundaryQuantizationSourcePin&next)const{
        return valid()&&next.valid()&&domain()==next.domain()&&
            next.get()->base_generation==lease_.generation&&
            get()->graph.output_epoch==next.get()->graph.output_epoch&&!next.get()->graph.output_reset;
    }
    const Owner*domain()const{return owner_;}
    void reset(){drop();}
};
}
#endif
